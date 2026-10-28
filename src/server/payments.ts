import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { formatMoney, orderCode } from "@/lib/format";
import { audit } from "./audit";
import { afterDelivery, deliverOrderTx } from "./delivery";
import { kickQueue, notifyStaff, notifyUser } from "./notifications";
import { orderLink } from "./orders";

export function normalizeReference(input: string) {
  const r = String(input ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z0-9]{4,40}$/.test(r)) throw new AppError("Escribe el número de operación tal como aparece en el comprobante (solo letras y números).");
  return r;
}

export type SubmitPaymentInput = {
  orderId: string;
  /** Quién envía: el dueño del pedido con sesión, o cualquiera con el enlace seguro del pedido. */
  auth: { customerId: string } | { accessToken: string };
  reference: string;
  amountCents: number;
  receiptPath: string | null;
  method?: string;
};

/** El cliente registra su pago manual (QR/Yape/Plin). Queda en revisión hasta que un empleado lo apruebe. */
export async function submitPayment(input: SubmitPaymentInput) {
  const order = await db.order.findUnique({ where: { id: input.orderId }, include: { customer: true } });
  const allowed = order && ("customerId" in input.auth ? order.customerId === input.auth.customerId : order.accessToken === input.auth.accessToken);
  if (!order || !allowed) throw new AppError("No encontramos ese pedido.");
  if (order.status !== "PENDIENTE") throw new AppError("Este pedido ya no espera pago.");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new AppError("Escribe el monto que pagaste.");
  if (!input.receiptPath) throw new AppError("Adjunta la foto o PDF del comprobante.");
  const reference = normalizeReference(input.reference);
  const pending = await db.payment.findFirst({ where: { orderId: order.id, status: "EN_REVISION" } });
  if (pending) throw new AppError("Ya enviaste un comprobante para este pedido. Espera a que lo revisemos.");

  let payment;
  try {
    payment = await db.payment.create({
      data: { orderId: order.id, method: input.method ?? "QR", reference, amountCents: input.amountCents, currency: order.currency, receiptPath: input.receiptPath },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw new AppError("Ese número de operación ya fue registrado en otro pago. Revisa el comprobante.");
    throw e;
  }
  await audit("customerId" in input.auth ? input.auth.customerId : order.customerId, "pago.enviado", "Payment", payment.id, { pedido: order.id, monto: input.amountCents });
  const vars = { code: orderCode(order.number), reference, total: formatMoney(input.amountCents, order.currency) };
  await notifyUser(order.customer, "payment.received", vars, `payment.received:${payment.id}`);
  await notifyStaff("admin.payment_review", { ...vars, link: `${env.appUrl}/admin/pagos` }, `review:${payment.id}`);
  kickQueue();
  return payment;
}

/**
 * Aprueba un pago. El empleado confirma el monto que llegó a la cuenta y debe coincidir con el total del pedido.
 * Pago, cambio de estado del pedido y entrega de códigos ocurren en una sola transacción.
 */
export async function approvePayment(paymentId: string, actorId: string, receivedCents: number) {
  const r = await db.$transaction(async tx => {
    const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!p) throw new AppError("No encontramos el pago.");
    if (p.status !== "EN_REVISION") throw new AppError("Este pago ya fue revisado.");
    if (p.order.status !== "PENDIENTE") throw new AppError("El pedido ya no está pendiente de pago (puede que otro pago ya se aprobara).");
    if (!Number.isInteger(receivedCents) || receivedCents !== p.order.totalCents)
      throw new AppError(`El monto recibido debe ser exactamente ${formatMoney(p.order.totalCents, p.order.currency)}. Si llegó otro monto, rechaza el pago y explica el motivo.`);
    if (p.currency !== p.order.currency) throw new AppError("La moneda del pago no coincide con la del pedido.");

    const up = await tx.payment.updateMany({ where: { id: paymentId, status: "EN_REVISION" }, data: { status: "APROBADO", reviewedById: actorId, reviewedAt: new Date() } });
    if (!up.count) throw new AppError("Este pago ya fue revisado.");
    const uo = await tx.order.updateMany({ where: { id: p.orderId, status: "PENDIENTE" }, data: { status: "PAGADO", paidAt: new Date() } });
    if (!uo.count) throw new AppError("El pedido ya no está pendiente de pago.");
    // Otros comprobantes en revisión del mismo pedido ya no hacen falta
    await tx.payment.updateMany({ where: { orderId: p.orderId, status: "EN_REVISION" }, data: { status: "RECHAZADO", reviewNote: "Pedido pagado con otro comprobante", reviewedAt: new Date(), reviewedById: actorId } });
    const delivery = await deliverOrderTx(tx, p.orderId);
    return { p, delivery };
  });

  await audit(actorId, "pago.aprobado", "Payment", paymentId, { pedido: r.p.orderId, monto: receivedCents });
  const customer = await db.user.findUniqueOrThrow({ where: { id: r.p.order.customerId } });
  await notifyUser(customer, "payment.approved", { code: orderCode(r.p.order.number), total: formatMoney(r.p.order.totalCents, r.p.order.currency) }, `payment.approved:${paymentId}`);
  await afterDelivery(r.delivery);
  kickQueue();
  return r.delivery;
}

export async function rejectPayment(paymentId: string, actorId: string, reason: string) {
  const why = reason.trim();
  if (why.length < 5) throw new AppError("Explica al cliente por qué rechazas el pago.");
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { order: { include: { customer: true } } } });
  if (!p) throw new AppError("No encontramos el pago.");
  const up = await db.payment.updateMany({ where: { id: paymentId, status: "EN_REVISION" }, data: { status: "RECHAZADO", reviewNote: why.slice(0, 500), reviewedById: actorId, reviewedAt: new Date() } });
  if (!up.count) throw new AppError("Este pago ya fue revisado.");
  await audit(actorId, "pago.rechazado", "Payment", paymentId, { motivo: why });
  await notifyUser(p.order.customer, "payment.rejected", { code: orderCode(p.order.number), reason: why, link: orderLink(p.order.accessToken) }, `payment.rejected:${paymentId}`);
  kickQueue();
}

/** Registra un reembolso hecho fuera de la plataforma: cancela el pedido y sus suscripciones. */
export async function refundPayment(paymentId: string, actorId: string, reason: string) {
  const why = reason.trim();
  if (why.length < 5) throw new AppError("Escribe el motivo del reembolso.");
  const p = await db.$transaction(async tx => {
    const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { order: { include: { customer: true, items: true } } } });
    if (!p) throw new AppError("No encontramos el pago.");
    const up = await tx.payment.updateMany({ where: { id: paymentId, status: "APROBADO" }, data: { status: "REEMBOLSADO", reviewNote: why.slice(0, 500), reviewedById: actorId, reviewedAt: new Date() } });
    if (!up.count) throw new AppError("Solo se pueden reembolsar pagos aprobados.");
    await tx.order.update({ where: { id: p.orderId }, data: { status: "CANCELADO", cancelledAt: new Date() } });
    const subs = await tx.subscription.findMany({ where: { orderItemId: { in: p.order.items.map(i => i.id) }, status: { not: "CANCELADA" } } });
    for (const s of subs) {
      await tx.subscription.update({ where: { id: s.id }, data: { status: "CANCELADA", cancelledAt: new Date() } });
      await tx.subscriptionEvent.create({ data: { subscriptionId: s.id, type: "CANCELACION", detail: `Reembolso: ${why}` } });
    }
    if (p.order.renewalOfId) {
      await tx.subscriptionEvent.create({ data: { subscriptionId: p.order.renewalOfId, type: "CANCELACION", detail: `Reembolso de la renovación ${orderCode(p.order.number)}. Revisa la fecha de vencimiento.` } });
    }
    return p;
  });
  await audit(actorId, "pago.reembolsado", "Payment", paymentId, { motivo: why, pedido: p.orderId });
  await notifyUser(p.order.customer, "payment.refunded", { code: orderCode(p.order.number) }, `payment.refunded:${paymentId}`);
  kickQueue();
}
