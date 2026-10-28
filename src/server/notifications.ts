import type { Notification, User } from "@prisma/client";
import { db } from "@/lib/db";
import { emailConfigured, sendEmail } from "./channels/email";
import { sendWhatsAppTemplate, sendWhatsAppText, WhatsAppError, whatsappConfigured } from "./channels/whatsapp";
import { env } from "@/lib/env";
import { getSettings } from "./settings";

type Vars = Record<string, string>;

// Plantillas de cada aviso. {variable} se reemplaza con los datos del evento.
export const TEMPLATES: Record<string, { subject: string; body: string }> = {
  "order.created": { subject: "Pedido {code} creado", body: "Hola {name}, registramos tu pedido {code} por {total}.\n\nPaga con el QR y envía tu comprobante aquí:\n{link}" },
  "payment.received": { subject: "Recibimos tu comprobante del pedido {code}", body: "Hola {name}, recibimos tu comprobante del pedido {code} (operación {reference}). Lo revisaremos pronto y te avisaremos." },
  "payment.approved": { subject: "Pago aprobado: pedido {code}", body: "Hola {name}, aprobamos tu pago de {total} del pedido {code}. Estamos preparando la entrega." },
  "payment.rejected": { subject: "Revisa tu pago del pedido {code}", body: "Hola {name}, no pudimos aprobar el pago del pedido {code}: {reason}\n\nPuedes enviar un nuevo comprobante aquí:\n{link}" },
  "payment.refunded": { subject: "Reembolso del pedido {code}", body: "Hola {name}, registramos el reembolso del pedido {code}. El pedido quedó cancelado." },
  "order.delivered": { subject: "Tu pedido {code} fue entregado", body: "Hola {name}, ¡tu pedido {code} ya está listo!\n\n{details}\n\nRevisa las instrucciones y tus vencimientos en:\n{link}" },
  "order.cancelled": { subject: "Pedido {code} cancelado", body: "Hola {name}, el pedido {code} fue cancelado. {reason}" },
  "subscription.reminder": { subject: "Tu {product} vence {when}", body: "Hola {name}, tu {product} ({plan}) vence {when}, el {date}.\n\nRenueva para no perder el acceso:\n{link}" },
  "subscription.expired": { subject: "Tu {product} venció", body: "Hola {name}, tu {product} ({plan}) venció el {date}. Puedes renovarlo aquí:\n{link}" },
  "subscription.renewed": { subject: "Renovación confirmada: {product}", body: "Hola {name}, renovamos tu {product}. Nuevo vencimiento: {date}." },
  "subscription.cancelled": { subject: "Suscripción cancelada: {product}", body: "Hola {name}, cancelamos tu suscripción de {product}. {reason}" },
  "admin.payment_review": { subject: "Comprobante por revisar: {code}", body: "Hay un comprobante nuevo del pedido {code} por {total} (operación {reference}).\n{link}" },
  "admin.out_of_stock": { subject: "Sin inventario para entregar {code}", body: "El pedido {code} está pagado pero no hay códigos disponibles de {product}. Carga inventario y reintenta la entrega:\n{link}" },
  "admin.low_stock": { subject: "Quedan pocos códigos de {product}", body: "Quedan {count} códigos disponibles de {product}.\n{link}" },
  "admin.handoff": { subject: "Un cliente pide hablar con un asesor", body: "{name} ({phone}) pidió hablar con una persona en WhatsApp.\n{link}" },
  "ticket.reply": { subject: "Respuesta a tu consulta: {subject}", body: "Hola {name}, respondimos tu consulta \"{subject}\".\n{link}" },
};

export function render(tpl: string, vars: Vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

type Recipient = Pick<User, "id" | "email" | "phone" | "name" | "notifyEmail" | "notifyWhatsapp">;

/**
 * Pone en cola un aviso para un usuario por cada canal disponible.
 * dedupeKey evita enviar dos veces el mismo aviso (por ejemplo, el mismo recordatorio).
 */
export async function notifyUser(user: Recipient, event: keyof typeof TEMPLATES, vars: Vars, dedupeKey: string) {
  const t = TEMPLATES[event];
  const s = await getSettings();
  const v = { name: user.name.split(" ")[0] || user.name, store: s["store.name"], ...vars };
  const rows: { channel: "EMAIL" | "WHATSAPP"; to: string }[] = [];
  if (s["channels.email"] === "1" && user.email && user.notifyEmail) rows.push({ channel: "EMAIL", to: user.email });
  if (s["channels.whatsapp"] === "1" && user.phone && user.notifyWhatsapp) rows.push({ channel: "WHATSAPP", to: user.phone });
  for (const r of rows) {
    await db.notification.upsert({
      where: { dedupeKey: `${dedupeKey}:${r.channel}` },
      create: { ...r, event, subject: `${render(t.subject, v)} · ${s["store.name"]}`, body: render(t.body, v), dedupeKey: `${dedupeKey}:${r.channel}`, userId: user.id },
      update: {},
    });
  }
  return rows.length;
}

/** Aviso interno para administradores y empleados activos. */
export async function notifyStaff(event: keyof typeof TEMPLATES, vars: Vars, dedupeKey: string, roles: ("ADMIN" | "EMPLEADO")[] = ["ADMIN", "EMPLEADO"]) {
  const staff = await db.user.findMany({ where: { role: { in: roles }, active: true } });
  for (const u of staff) await notifyUser(u, event, vars, `${dedupeKey}:${u.id}`);
}

const MAX_ATTEMPTS = 5;

async function deliver(n: Notification): Promise<"ENVIADA" | { skip: string }> {
  if (n.channel === "EMAIL") {
    if (!emailConfigured()) return { skip: "Correo no configurado (faltan SMTP_HOST y SMTP_FROM)." };
    await sendEmail(n.to, n.subject, n.body);
    return "ENVIADA";
  }
  if (!whatsappConfigured()) return { skip: "WhatsApp no configurado (faltan WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN)." };
  // WhatsApp solo permite texto libre dentro de las 24 h siguientes al último mensaje del cliente
  const conv = await db.conversation.findUnique({ where: { waId: n.to } });
  const inWindow = !!conv?.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < 23.5 * 3600_000;
  if (inWindow) {
    const id = await sendWhatsAppText(n.to, n.body);
    if (conv) await db.conversationMessage.create({ data: { conversationId: conv.id, direction: "OUT", body: n.body, externalId: id } });
    return "ENVIADA";
  }
  if (!env.whatsapp.templateNotice) return { skip: "Fuera de la ventana de 24 h y sin plantilla aprobada (WHATSAPP_TEMPLATE_NOTICE)." };
  await sendWhatsAppTemplate(n.to, n.body);
  return "ENVIADA";
}

/** Envía los avisos pendientes. Lo ejecuta el worker cada minuto y también se llama tras cada evento. */
export async function processNotificationQueue(limit = 50) {
  const due = await db.notification.findMany({
    where: { status: "PENDIENTE", sendAfter: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: limit,
  });
  let sent = 0, failed = 0, skipped = 0;
  for (const n of due) {
    // Reclama el aviso para que dos procesos no lo envíen a la vez
    const claim = await db.notification.updateMany({
      where: { id: n.id, status: "PENDIENTE", attempts: n.attempts },
      data: { attempts: { increment: 1 }, sendAfter: new Date(Date.now() + 10 * 60_000) },
    });
    if (!claim.count) continue;
    try {
      const r = await deliver(n);
      if (r === "ENVIADA") { await db.notification.update({ where: { id: n.id }, data: { status: "ENVIADA", sentAt: new Date(), error: null } }); sent++; }
      else { await db.notification.update({ where: { id: n.id }, data: { status: "OMITIDA", error: r.skip } }); skipped++; }
    } catch (e) {
      const attempts = n.attempts + 1;
      const retryable = !(e instanceof WhatsAppError) || e.retryable;
      const final = !retryable || attempts >= MAX_ATTEMPTS;
      console.error("[notificacion]", n.id, n.channel, e);
      await db.notification.update({
        where: { id: n.id },
        data: {
          status: final ? "FALLIDA" : "PENDIENTE",
          error: String((e as Error)?.message ?? e).slice(0, 500),
          sendAfter: new Date(Date.now() + 2 ** attempts * 60_000),
        },
      });
      failed++;
    }
  }
  return { sent, failed, skipped };
}

/** Lanza el envío sin bloquear la respuesta al usuario. */
export function kickQueue() {
  processNotificationQueue().catch(e => console.error("[notificacion] cola", e));
}
