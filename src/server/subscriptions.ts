import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { daysLeft, formatDate } from "@/lib/format";
import { audit } from "./audit";
import { kickQueue, notifyUser } from "./notifications";
import { createOrder, releaseReservations } from "./orders";
import { getSettings, reminderDays } from "./settings";

export async function cancelSubscription(subscriptionId: string, actorId: string, reason: string) {
  const why = reason.trim() || "Cancelada por la tienda.";
  const sub = await db.subscription.findUnique({ where: { id: subscriptionId }, include: { customer: true, product: true } });
  if (!sub) throw new AppError("No encontramos la suscripción.");
  const up = await db.subscription.updateMany({ where: { id: subscriptionId, status: { not: "CANCELADA" } }, data: { status: "CANCELADA", cancelledAt: new Date() } });
  if (!up.count) throw new AppError("La suscripción ya estaba cancelada.");
  await db.subscriptionEvent.create({ data: { subscriptionId, type: "CANCELACION", detail: why.slice(0, 500) } });
  await audit(actorId, "suscripcion.cancelada", "Subscription", subscriptionId, { motivo: why });
  await notifyUser(sub.customer, "subscription.cancelled", { product: sub.product.name, reason: why }, `sub.cancelled:${sub.id}`);
  kickQueue();
}

/** El cliente pide renovar: se crea un pedido de renovación con el plan elegido. */
export async function requestRenewal(subscriptionId: string, customerId: string, planId: string, idempotencyKey?: string) {
  return createOrder({ customerId, items: [{ planId, qty: 1 }], renewalOfId: subscriptionId, idempotencyKey: idempotencyKey ?? null });
}

/**
 * Tarea programada: marca vencidas las suscripciones y pone en cola los recordatorios configurados.
 * Las claves de deduplicación hacen que ejecutarla muchas veces no repita avisos.
 */
export async function runSubscriptionJobs(now = new Date()) {
  const s = await getSettings();
  const tz = s["store.timezone"];
  const days = reminderDays(s);
  const renewLink = `${env.appUrl}/cuenta/suscripciones`;

  const expired = await db.subscription.findMany({ where: { status: "ACTIVA", endAt: { lt: now } }, include: { customer: true, product: true, plan: true } });
  for (const sub of expired) {
    const up = await db.subscription.updateMany({ where: { id: sub.id, status: "ACTIVA", endAt: { lt: now } }, data: { status: "VENCIDA" } });
    if (!up.count) continue;
    await db.subscriptionEvent.create({ data: { subscriptionId: sub.id, type: "VENCIMIENTO", detail: `Venció el ${formatDate(sub.endAt, tz)}` } });
    await notifyUser(sub.customer, "subscription.expired", { product: sub.product.name, plan: sub.plan.name, date: formatDate(sub.endAt, tz), link: renewLink }, `sub.expired:${sub.id}:${sub.endAt.toISOString()}`);
  }

  let reminders = 0;
  if (days.length) {
    const horizon = new Date(now.getTime() + (Math.max(...days) + 1) * 86400000);
    const soon = await db.subscription.findMany({ where: { status: "ACTIVA", endAt: { gte: now, lte: horizon } }, include: { customer: true, product: true, plan: true } });
    for (const sub of soon) {
      const d = daysLeft(sub.endAt, tz, now);
      if (!days.includes(d)) continue;
      const when = d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`;
      const n = await notifyUser(sub.customer, "subscription.reminder", { product: sub.product.name, plan: sub.plan.name, when, date: formatDate(sub.endAt, tz), link: renewLink },
        `sub.reminder:${sub.id}:${sub.endAt.toISOString().slice(0, 10)}:${d}`);
      reminders += n;
    }
  }
  return { expired: expired.length, reminders };
}

/** Cancela pedidos sin pago tras 48 h y libera el stock reservado. No toca pedidos con comprobante en revisión. */
export async function cancelStaleOrders(now = new Date(), hours = 48) {
  const stale = await db.order.findMany({
    where: { status: "PENDIENTE", createdAt: { lt: new Date(now.getTime() - hours * 3600_000) }, payments: { none: { status: "EN_REVISION" } } },
    select: { id: true, couponId: true },
  });
  for (const o of stale) {
    await db.$transaction(async tx => {
      const up = await tx.order.updateMany({ where: { id: o.id, status: "PENDIENTE" }, data: { status: "CANCELADO", cancelledAt: now, note: "Cancelado automáticamente: sin pago en 48 h" } });
      if (!up.count) return;
      await releaseReservations(tx, o.id);
      if (o.couponId) await tx.coupon.updateMany({ where: { id: o.couponId, uses: { gt: 0 } }, data: { uses: { decrement: 1 } } });
    });
    await audit(null, "pedido.cancelado_auto", "Order", o.id);
  }
  return stale.length;
}
