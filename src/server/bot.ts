// Bot de ventas por WhatsApp Cloud API. Conversación por menús numerados.
import type { Conversation, Prisma, User } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { formatMoney, normalizePhone, orderCode } from "@/lib/format";
import { audit } from "./audit";
import { downloadWhatsAppMedia, sendWhatsAppText, whatsappConfigured } from "./channels/whatsapp";
import { kickQueue, notifyStaff } from "./notifications";
import { createOrder, orderLink } from "./orders";
import { normalizeReference, submitPayment } from "./payments";
import { getSettings } from "./settings";
import { saveUpload } from "./storage";

const STATUS_TEXT: Record<string, string> = {
  PENDIENTE: "pendiente de pago", PAGADO: "pagado", PROCESADO: "pagado, preparando la entrega", ENTREGADO: "entregado", CANCELADO: "cancelado",
};

type Incoming = {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type?: string };
  document?: { id: string; caption?: string; mime_type?: string };
  interactive?: { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
};

type WebhookPayload = {
  object?: string;
  entry?: { changes?: { value?: { contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: Incoming[] } }[] }[];
};

/** Envía y registra un mensaje del bot. Si WhatsApp no está configurado, solo lo registra. */
async function reply(conv: Conversation, text: string) {
  let externalId: string | null = null;
  if (whatsappConfigured()) {
    try { externalId = await sendWhatsAppText(conv.waId, text); }
    catch (e) { console.error("[bot] no se pudo responder", e); }
  }
  await db.conversationMessage.create({ data: { conversationId: conv.id, direction: "OUT", body: text, externalId } });
}

async function setState(conv: Conversation, state: string, data: Prisma.InputJsonValue = {}) {
  return db.conversation.update({ where: { id: conv.id }, data: { state, data } });
}

async function menuText() {
  const s = await getSettings();
  return `${s["bot.welcome"]}\n\nResponde con un número:\n1️⃣ Ver catálogo y precios\n2️⃣ Estado de mis pedidos\n3️⃣ Hablar con un asesor\n\nEscribe *menu* en cualquier momento para volver aquí.`;
}

async function showCatalog(conv: Conversation) {
  const products = await db.product.findMany({ where: { active: true, plans: { some: { active: true } } }, include: { plans: { where: { active: true }, orderBy: { priceCents: "asc" } } }, orderBy: { name: "asc" }, take: 20 });
  if (!products.length) { await reply(conv, "Por ahora no tenemos productos disponibles. Escribe 3 para hablar con un asesor."); return; }
  const currency = (await getSettings())["store.currency"];
  const lines = products.map((p, i) => `${i + 1}. *${p.name}* — desde ${formatMoney(p.plans[0].priceCents, currency)}`);
  await setState(await db.conversation.findUniqueOrThrow({ where: { id: conv.id } }), "CATALOG", { productIds: products.map(p => p.id) });
  await reply(conv, `🛍️ *Catálogo*\n\n${lines.join("\n")}\n\nResponde con el número del producto para ver sus planes, o 0 para volver.`);
}

async function showProduct(conv: Conversation, productId: string) {
  const p = await db.product.findUnique({ where: { id: productId }, include: { plans: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] } } });
  if (!p || !p.active || !p.plans.length) { await reply(conv, "Ese producto ya no está disponible."); return showCatalog(conv); }
  const currency = (await getSettings())["store.currency"];
  const stock = p.deliveryType === "LICENCIA" ? await db.license.count({ where: { productId: p.id, status: "DISPONIBLE" } }) : null;
  const plans = p.plans.map((pl, i) => `${i + 1}. ${pl.name} — *${formatMoney(pl.priceCents, currency)}* (${pl.durationDays} días)`);
  await setState(conv, "PRODUCT", { productId: p.id, planIds: p.plans.map(x => x.id) });
  await reply(conv, [
    `*${p.name}*`,
    p.shortDescription || p.description.slice(0, 500),
    stock === 0 ? "⚠️ Agotado por ahora. Puedes escribir 3 para que un asesor te avise." : "",
    `\n*Planes:*\n${plans.join("\n")}`,
    "\nResponde con el número del plan que quieres, o 0 para volver al catálogo.",
  ].filter(Boolean).join("\n"));
}

async function showOrders(conv: Conversation, user: User) {
  const orders = await db.order.findMany({ where: { customerId: user.id }, orderBy: { createdAt: "desc" }, take: 5, include: { items: true } });
  if (!orders.length) { await reply(conv, "Todavía no tienes pedidos. Escribe 1 para ver el catálogo."); return; }
  const lines = orders.map(o => `• ${orderCode(o.number)} — ${o.items.map(i => i.productName).join(", ")} — *${STATUS_TEXT[o.status]}*${o.status === "PENDIENTE" ? `\n  Pagar: ${orderLink(o.accessToken)}` : ""}`);
  await reply(conv, `📦 *Tus pedidos recientes*\n\n${lines.join("\n")}\n\nEscribe *menu* para volver.`);
}

async function handoff(conv: Conversation, user: User) {
  await db.conversation.update({ where: { id: conv.id }, data: { handoff: true, state: "MENU", data: {} } });
  await reply(conv, "👤 Listo, un asesor te responderá por aquí lo antes posible. Escribe *menu* si quieres volver al asistente.");
  await notifyStaff("admin.handoff", { name: user.name, phone: "+" + conv.waId, link: `${env.appUrl}/admin/whatsapp?c=${conv.id}` }, `handoff:${conv.id}:${Date.now()}`);
  kickQueue();
}

async function attachReceipt(conv: Conversation, user: User, mediaId: string, reference: string) {
  const order = await db.order.findFirst({ where: { customerId: user.id, status: "PENDIENTE" }, orderBy: { createdAt: "desc" } });
  if (!order) { await reply(conv, "No tienes pedidos pendientes de pago. Escribe 2 para ver tus pedidos."); return setState(conv, "MENU"); }
  const media = await downloadWhatsAppMedia(mediaId);
  const path = await saveUpload("receipts", media.data, media.mime);
  try {
    await submitPayment({ orderId: order.id, auth: { customerId: user.id }, reference, amountCents: order.totalCents, receiptPath: path, method: "QR" });
    await reply(conv, `✅ Recibimos tu comprobante del pedido ${orderCode(order.number)} (operación ${normalizeReference(reference)}). Te avisaremos apenas lo revisemos.`);
  } catch (e) {
    await reply(conv, e instanceof AppError ? `⚠️ ${e.message}` : "No pudimos registrar el comprobante. Inténtalo otra vez o escribe 3 para hablar con un asesor.");
  }
  await setState(conv, "MENU");
}

async function handleMessage(conv: Conversation, user: User, msg: Incoming) {
  const raw = msg.text?.body ?? msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id ?? "";
  const text = raw.trim().toLowerCase();
  const num = /^\d{1,2}$/.test(text) ? Number(text) : null;
  const data = (conv.data ?? {}) as Record<string, unknown>;

  if (["menu", "menú", "hola", "inicio", "buenas"].includes(text)) {
    if (conv.handoff) await db.conversation.update({ where: { id: conv.id }, data: { handoff: false } });
    await setState(conv, "MENU");
    return reply(conv, await menuText());
  }
  if (conv.handoff) return; // lo atiende una persona desde el panel

  // Foto o PDF del comprobante
  const media = msg.image ?? msg.document;
  if (media) {
    const ref = (media.caption ?? "").match(/[A-Za-z0-9]{4,40}/g)?.find(x => /\d/.test(x));
    if (ref) return attachReceipt(conv, user, media.id, ref);
    await setState(conv, "AWAIT_REF", { mediaId: media.id });
    return reply(conv, "📸 Recibí la imagen. Ahora escríbeme el *número de operación* que aparece en el comprobante.");
  }

  switch (conv.state) {
    case "AWAIT_REF":
      if (typeof data.mediaId === "string" && text) return attachReceipt(conv, user, data.mediaId, raw);
      break;
    case "CATALOG": {
      const ids = (data.productIds as string[]) ?? [];
      if (num === 0) { await setState(conv, "MENU"); return reply(conv, await menuText()); }
      if (num && ids[num - 1]) return showProduct(conv, ids[num - 1]);
      return reply(conv, `Responde con un número del 1 al ${ids.length}, o 0 para volver.`);
    }
    case "PRODUCT": {
      const planIds = (data.planIds as string[]) ?? [];
      if (num === 0) return showCatalog(conv);
      if (num && planIds[num - 1]) {
        const plan = await db.plan.findUniqueOrThrow({ where: { id: planIds[num - 1] }, include: { product: true } });
        const currency = (await getSettings())["store.currency"];
        await setState(conv, "CONFIRM", { planId: plan.id, productId: plan.productId });
        return reply(conv, `Elegiste *${plan.product.name} — ${plan.name}* por *${formatMoney(plan.priceCents, currency)}* (${plan.durationDays} días).\n\n1️⃣ Confirmar pedido\n2️⃣ Elegir otro plan`);
      }
      return reply(conv, `Responde con el número del plan, o 0 para volver al catálogo.`);
    }
    case "CONFIRM": {
      if (num === 2) return showProduct(conv, String(data.productId));
      if (num === 1 || ["si", "sí", "confirmar"].includes(text)) {
        try {
          const order = await createOrder({ customerId: user.id, items: [{ planId: String(data.planId), qty: 1 }], channel: "WHATSAPP", idempotencyKey: `wa:${msg.id}` });
          const s = await getSettings();
          await setState(conv, "MENU");
          return reply(conv, [
            `🧾 Pedido *${orderCode(order.number)}* creado por *${formatMoney(order.totalCents, order.currency)}*.`,
            `\n${s["payment.instructions"]}`,
            s["payment.holder"] ? `Titular: ${s["payment.holder"]}` : "",
            `\nVe el QR y envía tu comprobante aquí:\n${orderLink(order.accessToken)}`,
            "\nO envíame en este chat la foto del comprobante con el número de operación.",
          ].filter(Boolean).join("\n"));
        } catch (e) {
          await setState(conv, "MENU");
          return reply(conv, e instanceof AppError ? `⚠️ ${e.message}\n\nEscribe *menu* para volver.` : "No pudimos crear el pedido. Escribe 3 para hablar con un asesor.");
        }
      }
      return reply(conv, "Responde 1 para confirmar o 2 para elegir otro plan.");
    }
  }

  if (num === 1 || text.includes("catalogo") || text.includes("catálogo") || text.includes("precio")) return showCatalog(conv);
  if (num === 2 || text.includes("pedido") || text.includes("estado")) return showOrders(conv, user);
  if (num === 3 || text.includes("asesor") || text.includes("humano") || text.includes("persona")) return handoff(conv, user);
  return reply(conv, await menuText());
}

/** Procesa el cuerpo de un webhook de WhatsApp (ya verificado). */
export async function handleWhatsAppWebhook(payload: WebhookPayload) {
  const s = await getSettings();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const msg of value.messages ?? []) {
        const waId = normalizePhone(msg.from);
        if (!waId) continue;
        const profileName = value.contacts?.find(c => c.wa_id === msg.from)?.profile?.name?.slice(0, 80) || `Cliente ${waId.slice(-4)}`;

        let user = await db.user.findUnique({ where: { phone: waId } });
        if (!user) user = await db.user.create({ data: { name: profileName, phone: waId, role: "CLIENTE" } });
        const conv = await db.conversation.upsert({
          where: { waId },
          create: { waId, userId: user.id, lastInboundAt: new Date() },
          update: { lastInboundAt: new Date(), userId: user.id },
        });
        const body = msg.text?.body ?? msg.image?.caption ?? msg.document?.caption ?? msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? `[${msg.type}]`;
        try {
          // El id único del mensaje impide procesarlo dos veces si Meta reintenta el webhook
          await db.conversationMessage.create({ data: { conversationId: conv.id, direction: "IN", body: body.slice(0, 4000), externalId: msg.id } });
        } catch {
          continue;
        }
        if (s["bot.enabled"] !== "1") continue;
        try { await handleMessage(conv, user, msg); }
        catch (e) { console.error("[bot] error procesando mensaje", msg.id, e); await reply(conv, "Tuvimos un problema. Escribe *menu* para empezar de nuevo o 3 para hablar con un asesor."); }
      }
    }
  }
}

/** Respuesta manual de un empleado desde el panel. */
export async function staffReply(conversationId: string, actorId: string, text: string) {
  const body = text.trim();
  if (!body) throw new AppError("Escribe el mensaje.");
  const conv = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) throw new AppError("No encontramos la conversación.");
  if (!whatsappConfigured()) throw new AppError("WhatsApp no está configurado. Agrega las credenciales en el archivo .env.");
  if (!conv.lastInboundAt || Date.now() - conv.lastInboundAt.getTime() > 24 * 3600_000)
    throw new AppError("Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite escribirle con una plantilla aprobada.");
  const id = await sendWhatsAppText(conv.waId, body);
  await db.conversationMessage.create({ data: { conversationId: conv.id, direction: "OUT", body, externalId: id } });
  await audit(actorId, "whatsapp.respuesta", "Conversation", conv.id);
}

export async function setHandoff(conversationId: string, actorId: string, on: boolean) {
  await db.conversation.update({ where: { id: conversationId }, data: { handoff: on, state: "MENU", data: {} } });
  await audit(actorId, on ? "whatsapp.tomar" : "whatsapp.liberar", "Conversation", conversationId);
}
