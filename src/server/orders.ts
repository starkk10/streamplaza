import { Prisma, type Coupon, type OrderChannel } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { randomToken } from "@/lib/crypto";
import { formatMoney, orderCode } from "@/lib/format";
import { audit } from "./audit";
import { kickQueue, notifyUser } from "./notifications";
import { getSettings } from "./settings";

export const cartSchema = z.array(z.object({
  planId: z.string().min(1),
  qty: z.coerce.number().int().min(1, "Cantidad no válida.").max(5, "Máximo 5 unidades por plan."),
})).min(1, "Tu carrito está vacío.").max(10, "Máximo 10 productos distintos por pedido.");

export type CartInput = z.input<typeof cartSchema>;

export function couponDiscount(c: Coupon, subtotal: number): number {
  const d = c.type === "PORCENTAJE" ? Math.round(subtotal * Math.min(100, Math.max(0, c.value)) / 100) : c.value;
  return Math.min(subtotal, Math.max(0, d));
}

export async function findValidCoupon(code: string | undefined | null, subtotal: number, tx: Tx = db) {
  const clean = (code ?? "").trim().toUpperCase();
  if (!clean) return null;
  const c = await tx.coupon.findUnique({ where: { code: clean } });
  const now = new Date();
  if (!c || !c.active) throw new AppError("El cupón no existe o no está activo.");
  if (c.startsAt && c.startsAt > now) throw new AppError("El cupón todavía no está vigente.");
  if (c.endsAt && c.endsAt < now) throw new AppError("El cupón ya venció.");
  if (c.maxUses != null && c.uses >= c.maxUses) throw new AppError("El cupón ya alcanzó su límite de usos.");
  if (subtotal < c.minTotalCents) throw new AppError(`El cupón requiere una compra mínima de ${formatMoney(c.minTotalCents, (await getSettings())["store.currency"])}.`);
  return c;
}

/** Calcula el pedido con los precios de la base de datos (nunca con los que envía el navegador). */
export async function quoteCart(input: CartInput, couponCode?: string | null, tx: Tx = db) {
  const items = cartSchema.parse(input);
  const currency = (await getSettings())["store.currency"];
  const plans = await tx.plan.findMany({ where: { id: { in: items.map(i => i.planId) } }, include: { product: true } });
  const lines = items.map(i => {
    const p = plans.find(x => x.id === i.planId);
    if (!p || !p.active || !p.product.active) throw new AppError("Un producto de tu carrito ya no está disponible. Revisa el carrito.");
    return { plan: p, qty: i.qty, lineCents: p.priceCents * i.qty };
  });
  const subtotal = lines.reduce((a, l) => a + l.lineCents, 0);
  const coupon = await findValidCoupon(couponCode, subtotal, tx);
  const discount = coupon ? couponDiscount(coupon, subtotal) : 0;
  return { lines, subtotal, discount, total: subtotal - discount, currency, coupon };
}

/** Reserva un código libre para un ítem. Bloquea la fila para que dos pedidos no tomen el mismo. */
export async function takeFreeLicense(tx: Tx, productId: string, orderItemId: string, status: "RESERVADO" | "ENTREGADO") {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "License"
    WHERE "productId" = ${productId} AND status = 'DISPONIBLE' AND "orderItemId" IS NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > now())
    ORDER BY "createdAt" ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED`;
  if (!rows.length) return null;
  return tx.license.update({
    where: { id: rows[0].id },
    data: { status, orderItemId, assignedAt: status === "ENTREGADO" ? new Date() : null },
  });
}

export type CreateOrderInput = {
  customerId: string;
  items: CartInput;
  couponCode?: string | null;
  channel?: OrderChannel;
  idempotencyKey?: string | null;
  renewalOfId?: string | null;
  note?: string;
};

export async function createOrder(input: CreateOrderInput) {
  if (input.idempotencyKey) {
    const prev = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (prev) {
      if (prev.customerId !== input.customerId) throw new AppError("No se pudo crear el pedido. Recarga la página.");
      return prev; // el mismo envío repetido no crea un segundo pedido
    }
  }
  const customer = await db.user.findUnique({ where: { id: input.customerId } });
  if (!customer || !customer.active) throw new AppError("La cuenta del cliente no está activa.");

  let order;
  try {
    order = await db.$transaction(async tx => {
      const q = await quoteCart(input.items, input.couponCode, tx);

      if (input.renewalOfId) {
        const sub = await tx.subscription.findUnique({ where: { id: input.renewalOfId } });
        if (!sub || sub.customerId !== input.customerId) throw new AppError("No encontramos esa suscripción en tu cuenta.");
        if (sub.status === "CANCELADA") throw new AppError("Esa suscripción fue cancelada y no se puede renovar.");
        if (q.lines.length !== 1 || q.lines[0].qty !== 1 || q.lines[0].plan.productId !== sub.productId)
          throw new AppError("La renovación debe ser de un plan del mismo producto.");
        const open = await tx.order.findFirst({ where: { renewalOfId: sub.id, status: { in: ["PENDIENTE", "PAGADO", "PROCESADO"] } } });
        if (open) throw new AppError(`Ya tienes una renovación en curso: pedido ${orderCode(open.number)}.`);
      }

      if (q.coupon) {
        const used = await tx.coupon.updateMany({
          where: { id: q.coupon.id, OR: [{ maxUses: null }, { uses: { lt: q.coupon.maxUses ?? 0 } }] },
          data: { uses: { increment: 1 } },
        });
        if (!used.count) throw new AppError("El cupón ya alcanzó su límite de usos.");
      }

      const created = await tx.order.create({
        data: {
          customerId: input.customerId, channel: input.channel ?? "WEB", currency: q.currency,
          subtotalCents: q.subtotal, discountCents: q.discount, totalCents: q.total, couponId: q.coupon?.id,
          idempotencyKey: input.idempotencyKey || null, accessToken: randomToken(24),
          renewalOfId: input.renewalOfId || null, note: (input.note ?? "").slice(0, 500),
          items: {
            create: q.lines.flatMap(l => Array.from({ length: l.qty }, () => ({
              planId: l.plan.id, productName: l.plan.product.name, planName: l.plan.name,
              durationDays: l.plan.durationDays, unitPriceCents: l.plan.priceCents,
            }))),
          },
        },
        include: { items: { include: { plan: { include: { product: true } } } } },
      });

      // Reserva el stock ahora; el código se entrega solo cuando se apruebe el pago
      if (!input.renewalOfId) {
        for (const it of created.items) {
          if (it.plan.product.deliveryType !== "LICENCIA") continue;
          const lic = await takeFreeLicense(tx, it.plan.productId, it.id, "RESERVADO");
          if (!lic) throw new AppError(`${it.productName} está agotado por ahora. Quítalo del carrito o elige menos unidades.`);
        }
      }
      return created;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && input.idempotencyKey) {
      const prev = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (prev) return prev;
    }
    throw e;
  }

  await audit(input.customerId, "pedido.creado", "Order", order.id, { total: order.totalCents, canal: order.channel });
  await notifyUser(customer, "order.created", {
    code: orderCode(order.number), total: formatMoney(order.totalCents, order.currency), link: orderLink(order.accessToken),
  }, `order.created:${order.id}`);
  kickQueue();
  return order;
}

export function orderLink(accessToken: string) {
  return `${env.appUrl}/pedido/${accessToken}`;
}

/** Libera los códigos reservados de un pedido que no se pagó. */
export async function releaseReservations(tx: Tx, orderId: string) {
  return tx.license.updateMany({
    where: { status: "RESERVADO", orderItem: { orderId } },
    data: { status: "DISPONIBLE", orderItemId: null, assignedAt: null },
  });
}

export async function cancelOrder(orderId: string, actorId: string | null, reason: string) {
  const order = await db.$transaction(async tx => {
    const o = await tx.order.findUnique({ where: { id: orderId } });
    if (!o) throw new AppError("No encontramos el pedido.");
    if (o.status !== "PENDIENTE") throw new AppError("Solo se pueden cancelar pedidos pendientes de pago. Para un pedido pagado registra un reembolso.");
    const upd = await tx.order.updateMany({ where: { id: orderId, status: "PENDIENTE" }, data: { status: "CANCELADO", cancelledAt: new Date() } });
    if (!upd.count) throw new AppError("El pedido cambió de estado. Recarga la página.");
    await releaseReservations(tx, orderId);
    await tx.payment.updateMany({ where: { orderId, status: "EN_REVISION" }, data: { status: "RECHAZADO", reviewNote: "Pedido cancelado", reviewedAt: new Date(), reviewedById: actorId } });
    if (o.couponId) await tx.coupon.updateMany({ where: { id: o.couponId, uses: { gt: 0 } }, data: { uses: { decrement: 1 } } });
    return o;
  });
  await audit(actorId, "pedido.cancelado", "Order", orderId, { motivo: reason });
  const customer = await db.user.findUniqueOrThrow({ where: { id: order.customerId } });
  await notifyUser(customer, "order.cancelled", { code: orderCode(order.number), reason }, `order.cancelled:${order.id}`);
  kickQueue();
}
