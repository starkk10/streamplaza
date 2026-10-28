import { db } from "@/lib/db";
import { dayKey } from "@/lib/format";

export type Period = "dia" | "semana" | "mes";

/** Ingresos = pagos aprobados (sin reembolsos) en el periodo, agrupados por día en la zona de la tienda. */
export async function salesStats(period: Period, tz: string) {
  const now = new Date();
  const days = period === "dia" ? 1 : period === "semana" ? 7 : 30;
  const since = new Date(now.getTime() - days * 86400000);
  const seriesDays = Math.max(days, 14);
  const seriesSince = new Date(now.getTime() - seriesDays * 86400000);

  const [paid, ordersByStatus, newCustomers, series] = await Promise.all([
    db.payment.aggregate({ where: { status: "APROBADO", reviewedAt: { gte: since } }, _sum: { amountCents: true }, _count: true }),
    db.order.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: true }),
    db.user.count({ where: { role: "CLIENTE", createdAt: { gte: since } } }),
    db.payment.findMany({ where: { status: "APROBADO", reviewedAt: { gte: seriesSince } }, select: { amountCents: true, reviewedAt: true } }),
  ]);

  const buckets = new Map<string, number>();
  for (let i = seriesDays - 1; i >= 0; i--) buckets.set(dayKey(new Date(now.getTime() - i * 86400000), tz), 0);
  for (const p of series) {
    const k = dayKey(p.reviewedAt!, tz);
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + p.amountCents);
  }
  const ordersTotal = ordersByStatus.reduce((a, r) => a + r._count, 0);
  return {
    revenueCents: paid._sum.amountCents ?? 0,
    paidCount: paid._count,
    ordersTotal,
    ordersByStatus: Object.fromEntries(ordersByStatus.map(r => [r.status, r._count])) as Record<string, number>,
    newCustomers,
    series: [...buckets.entries()].map(([day, cents]) => ({ day, cents })),
  };
}

export async function dashboardAlerts() {
  const in3 = new Date(Date.now() + 3 * 86400000);
  const [paymentsToReview, ordersToDeliver, expiringSoon, failedNotifications, handoffs, openTickets, lowStock] = await Promise.all([
    db.payment.count({ where: { status: "EN_REVISION" } }),
    db.order.count({ where: { status: "PROCESADO" } }),
    db.subscription.count({ where: { status: "ACTIVA", endAt: { lte: in3 } } }),
    db.notification.count({ where: { status: "FALLIDA" } }),
    db.conversation.count({ where: { handoff: true } }),
    db.supportTicket.count({ where: { status: "ABIERTO" } }),
    lowStockProducts(),
  ]);
  return { paymentsToReview, ordersToDeliver, expiringSoon, failedNotifications, handoffs, openTickets, lowStock };
}

export async function lowStockProducts() {
  const products = await db.product.findMany({ where: { active: true, deliveryType: "LICENCIA" }, select: { id: true, name: true, lowStockAlert: true } });
  const counts = await db.license.groupBy({ by: ["productId"], where: { status: "DISPONIBLE" }, _count: true });
  return products.map(p => ({ ...p, available: counts.find(c => c.productId === p.id)?._count ?? 0 })).filter(p => p.available <= p.lowStockAlert);
}
