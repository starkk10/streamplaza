"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCustomer } from "@/lib/session";
import { AppError, toResult, type ActionResult } from "@/lib/errors";
import { normalizePhone } from "@/lib/format";
import { requestRenewal } from "@/server/subscriptions";
import { audit } from "@/server/audit";
import { cancelOrder } from "@/server/orders";

type R = ActionResult<unknown>;

export async function renewAction(_: R | null, fd: FormData): Promise<R> {
  const r = await toResult(async () => {
    const user = await requireCustomer();
    const order = await requestRenewal(String(fd.get("subscriptionId")), user.id, String(fd.get("planId")), `renew:${String(fd.get("key")).slice(0, 64)}`);
    return order.id;
  });
  if (!r.ok) return r;
  redirect(`/cuenta/pedidos/${r.data}?nuevo=1`);
}

export async function cancelMyOrderAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const user = await requireCustomer();
    const order = await db.order.findUnique({ where: { id: String(fd.get("orderId")) } });
    if (!order || order.customerId !== user.id) throw new AppError("No encontramos el pedido.");
    await cancelOrder(order.id, user.id, "Cancelado por el cliente.");
    revalidatePath(`/cuenta/pedidos/${order.id}`);
  }, "Pedido cancelado.");
}

const ticketSchema = z.object({
  subject: z.string().trim().min(4, "Escribe un asunto.").max(120),
  message: z.string().trim().min(10, "Cuéntanos un poco más (mínimo 10 caracteres).").max(4000),
});

export async function createTicketAction(_: R | null, fd: FormData): Promise<R> {
  const r = await toResult(async () => {
    const user = await requireCustomer();
    const p = ticketSchema.safeParse({ subject: fd.get("subject"), message: fd.get("message") });
    if (!p.success) throw new AppError(p.error.issues[0].message);
    const orderId = String(fd.get("orderId") ?? "") || null;
    if (orderId && !(await db.order.findFirst({ where: { id: orderId, customerId: user.id } }))) throw new AppError("Ese pedido no es tuyo.");
    const t = await db.supportTicket.create({ data: { customerId: user.id, subject: p.data.subject, orderId, replies: { create: { authorId: user.id, message: p.data.message } } } });
    await audit(user.id, "soporte.creado", "SupportTicket", t.id);
    return t.id;
  });
  if (!r.ok) return r;
  redirect(`/cuenta/soporte/${r.data}`);
}

export async function replyTicketAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const user = await requireCustomer();
    const t = await db.supportTicket.findUnique({ where: { id: String(fd.get("ticketId")) } });
    if (!t || t.customerId !== user.id) throw new AppError("No encontramos la consulta.");
    if (t.status === "CERRADO") throw new AppError("Esta consulta está cerrada. Abre una nueva.");
    const message = String(fd.get("message") ?? "").trim();
    if (message.length < 2) throw new AppError("Escribe tu mensaje.");
    await db.$transaction([
      db.ticketReply.create({ data: { ticketId: t.id, authorId: user.id, message: message.slice(0, 4000) } }),
      db.supportTicket.update({ where: { id: t.id }, data: { status: "ABIERTO" } }),
    ]);
    revalidatePath(`/cuenta/soporte/${t.id}`);
  }, "Mensaje enviado.");
}

export async function updateProfileAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const user = await requireCustomer();
    const name = String(fd.get("name") ?? "").trim();
    const phoneRaw = String(fd.get("phone") ?? "").trim();
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    if (name.length < 2) throw new AppError("Escribe tu nombre.");
    if (phone && (phone.length < 8 || phone.length > 15)) throw new AppError("El WhatsApp debe incluir el código de país.");
    if (phone && phone !== user.phone && (await db.user.findUnique({ where: { phone } }))) throw new AppError("Ese número ya está registrado en otra cuenta.");
    await db.user.update({ where: { id: user.id }, data: { name: name.slice(0, 80), phone, notifyEmail: fd.get("notifyEmail") === "on", notifyWhatsapp: fd.get("notifyWhatsapp") === "on" } });
    revalidatePath("/cuenta", "layout");
  }, "Perfil actualizado.");
}
