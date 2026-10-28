import { db, type Tx } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { addDays, formatDate, orderCode } from "@/lib/format";
import { audit } from "./audit";
import { kickQueue, notifyStaff, notifyUser } from "./notifications";
import { takeFreeLicense } from "./orders";
import { getSettings } from "./settings";

export type DeliveryResult = { orderId: string; complete: boolean; outOfStock: string[]; manualPending: string[] };

/**
 * Entrega lo que se pueda de un pedido pagado. Se ejecuta dentro de la misma transacción que aprueba el pago,
 * así un código nunca queda asignado sin pago ni se entrega dos veces.
 */
export async function deliverOrderTx(tx: Tx, orderId: string): Promise<DeliveryResult> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { plan: { include: { product: true } }, license: true, subscription: true } } },
  });
  if (!order) throw new AppError("No encontramos el pedido.");
  if (order.status !== "PAGADO" && order.status !== "PROCESADO") throw new AppError("El pedido no está pagado.");
  const now = new Date();
  const outOfStock: string[] = [], manualPending: string[] = [];

  for (const it of order.items) {
    if (it.deliveredAt) continue;

    if (order.renewalOfId) {
      const sub = await tx.subscription.findUniqueOrThrow({ where: { id: order.renewalOfId } });
      const from = sub.endAt > now ? sub.endAt : now;
      const endAt = addDays(from, it.durationDays);
      await tx.subscription.update({ where: { id: sub.id }, data: { endAt, status: "ACTIVA", planId: it.planId } });
      await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, type: "RENOVACION", detail: `Pedido ${orderCode(order.number)}: +${it.durationDays} días hasta ${endAt.toISOString().slice(0, 10)}` } });
      await tx.orderItem.update({ where: { id: it.id }, data: { deliveredAt: now } });
      continue;
    }

    let licenseId: string | null = null;
    if (it.plan.product.deliveryType === "LICENCIA") {
      if (it.license && it.license.status === "RESERVADO") {
        await tx.license.update({ where: { id: it.license.id }, data: { status: "ENTREGADO", assignedAt: now } });
        licenseId = it.license.id;
      } else if (!it.license) {
        const lic = await takeFreeLicense(tx, it.plan.productId, it.id, "ENTREGADO");
        if (!lic) { outOfStock.push(it.productName); continue; }
        licenseId = lic.id;
      } else {
        licenseId = it.license.id;
      }
    } else if (!it.deliveryNote) {
      manualPending.push(it.productName);
      continue;
    }

    await tx.orderItem.update({ where: { id: it.id }, data: { deliveredAt: now } });
    if (!it.subscription) {
      const sub = await tx.subscription.create({
        data: {
          customerId: order.customerId, productId: it.plan.productId, planId: it.planId, orderItemId: it.id,
          licenseId, startAt: now, endAt: addDays(now, it.durationDays),
        },
      });
      await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, type: "ALTA", detail: `Pedido ${orderCode(order.number)}` } });
    }
  }

  const complete = !outOfStock.length && !manualPending.length;
  await tx.order.update({
    where: { id: orderId },
    data: complete ? { status: "ENTREGADO", deliveredAt: now } : { status: "PROCESADO" },
  });
  return { orderId, complete, outOfStock, manualPending };
}

/** Avisos que se envían después de confirmar la transacción. */
export async function afterDelivery(r: DeliveryResult) {
  const order = await db.order.findUniqueOrThrow({
    where: { id: r.orderId },
    include: { customer: true, items: { include: { license: true, plan: { include: { product: true } }, subscription: true } }, renewalOf: { include: { product: true } } },
  });
  const s = await getSettings();
  const tz = s["store.timezone"];
  const code = orderCode(order.number);

  if (r.complete) {
    let details: string;
    if (order.renewalOf) {
      details = `Renovaste ${order.renewalOf.product.name}. Nuevo vencimiento: ${formatDate(order.renewalOf.endAt, tz)}.`;
      await notifyUser(order.customer, "subscription.renewed", { product: order.renewalOf.product.name, date: formatDate(order.renewalOf.endAt, tz) }, `sub.renewed:${order.id}`);
    } else {
      details = order.items.map(it => {
        const parts = [`• ${it.productName} (${it.planName})`];
        if (it.license) parts.push(`  Código: ${decrypt(it.license.codeEnc)}`);
        if (it.deliveryNote) parts.push(`  ${it.deliveryNote}`);
        if (it.subscription) parts.push(`  Vence: ${formatDate(it.subscription.endAt, tz)}`);
        if (it.plan.product.instructions) parts.push(`  Instrucciones: ${it.plan.product.instructions}`);
        return parts.join("\n");
      }).join("\n\n");
    }
    await notifyUser(order.customer, "order.delivered", { code, details, link: `${env.appUrl}/cuenta/suscripciones` }, `order.delivered:${order.id}`);
  }
  for (const product of new Set(r.outOfStock)) {
    await notifyStaff("admin.out_of_stock", { code, product, link: `${env.appUrl}/admin/pedidos/${order.id}` }, `oos:${order.id}:${product}`, ["ADMIN"]);
  }
  await checkLowStock([...new Set(order.items.map(i => i.plan.productId))]);
  kickQueue();
}

export async function checkLowStock(productIds: string[]) {
  const today = new Date().toISOString().slice(0, 10);
  for (const id of productIds) {
    const p = await db.product.findUnique({ where: { id } });
    if (!p || p.deliveryType !== "LICENCIA") continue;
    const count = await db.license.count({ where: { productId: id, status: "DISPONIBLE" } });
    if (count <= p.lowStockAlert) {
      await notifyStaff("admin.low_stock", { product: p.name, count: String(count), link: `${env.appUrl}/admin/licencias?producto=${p.id}` }, `lowstock:${id}:${today}`, ["ADMIN"]);
    }
  }
}

/** Reintenta la entrega de un pedido pagado (por ejemplo, tras cargar más códigos). */
export async function retryDelivery(orderId: string, actorId: string) {
  const r = await db.$transaction(tx => deliverOrderTx(tx, orderId));
  await audit(actorId, "pedido.reintento_entrega", "Order", orderId, { completo: r.complete, sinStock: r.outOfStock });
  await afterDelivery(r);
  return r;
}

/** Entrega manual de un ítem (productos sin código): el empleado escribe los datos de acceso o la nota. */
export async function deliverItemManually(orderItemId: string, note: string, actorId: string) {
  const clean = note.trim();
  if (clean.length < 3) throw new AppError("Escribe la nota de entrega para el cliente.");
  const item = await db.orderItem.findUnique({ where: { id: orderItemId }, include: { order: true } });
  if (!item) throw new AppError("No encontramos el ítem.");
  if (item.deliveredAt) throw new AppError("Ese ítem ya fue entregado.");
  if (item.order.status !== "PAGADO" && item.order.status !== "PROCESADO") throw new AppError("El pedido aún no está pagado.");
  const r = await db.$transaction(async tx => {
    const upd = await tx.orderItem.updateMany({ where: { id: orderItemId, deliveredAt: null, deliveryNote: null }, data: { deliveryNote: clean.slice(0, 2000) } });
    if (!upd.count) throw new AppError("Ese ítem ya tiene una entrega registrada.");
    return deliverOrderTx(tx, item.orderId);
  });
  await audit(actorId, "pedido.entrega_manual", "OrderItem", orderItemId);
  await afterDelivery(r);
  return r;
}
