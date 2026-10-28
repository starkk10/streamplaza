// Cliente de la API oficial de WhatsApp Cloud (Meta Graph API).
// Documentación: https://developers.facebook.com/docs/whatsapp/cloud-api
import { env } from "@/lib/env";
import { hmacSha256Hex, safeEqual } from "@/lib/crypto";

export class WhatsAppError extends Error {
  constructor(message: string, public status?: number, public retryable = true) { super(message); }
}

const base = () => `https://graph.facebook.com/${env.whatsapp.apiVersion}`;

export function whatsappConfigured() {
  return env.whatsapp.configured;
}

async function call(path: string, body: unknown) {
  const res = await fetch(`${base()}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.whatsapp.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    // 4xx salvo 429 no se arreglan reintentando
    throw new WhatsAppError(`WhatsApp: ${msg}`, res.status, res.status === 429 || res.status >= 500);
  }
  return json as { messages?: { id: string }[] };
}

export async function sendWhatsAppText(to: string, text: string) {
  const r = await call(`${env.whatsapp.phoneNumberId}/messages`, {
    messaging_product: "whatsapp", recipient_type: "individual", to, type: "text",
    text: { preview_url: true, body: text.slice(0, 4096) },
  });
  return r.messages?.[0]?.id ?? null;
}

/** Plantilla aprobada con una variable {{1}}. Los parámetros no admiten saltos de línea. */
export async function sendWhatsAppTemplate(to: string, text: string) {
  const param = text.replace(/\s*\n+\s*/g, " · ").replace(/\s{4,}/g, "   ").slice(0, 1000);
  const r = await call(`${env.whatsapp.phoneNumberId}/messages`, {
    messaging_product: "whatsapp", to, type: "template",
    template: {
      name: env.whatsapp.templateNotice,
      language: { code: env.whatsapp.templateLang },
      components: [{ type: "body", parameters: [{ type: "text", text: param }] }],
    },
  });
  return r.messages?.[0]?.id ?? null;
}

/** Descarga un archivo (foto del comprobante) enviado por el cliente. */
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ data: Buffer; mime: string }> {
  const meta = await fetch(`${base()}/${mediaId}`, { headers: { Authorization: `Bearer ${env.whatsapp.accessToken}` } });
  if (!meta.ok) throw new WhatsAppError(`No se pudo obtener el archivo (${meta.status})`, meta.status);
  const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string };
  const file = await fetch(url, { headers: { Authorization: `Bearer ${env.whatsapp.accessToken}` } });
  if (!file.ok) throw new WhatsAppError(`No se pudo descargar el archivo (${file.status})`, file.status);
  return { data: Buffer.from(await file.arrayBuffer()), mime: mime_type };
}

/** Verifica la cabecera X-Hub-Signature-256 que Meta envía con cada webhook. */
export function verifyWebhookSignature(rawBody: string, header: string | null): boolean {
  const secret = env.whatsapp.appSecret;
  if (!secret || !header?.startsWith("sha256=")) return false;
  return safeEqual(header.slice(7), hmacSha256Hex(secret, rawBody));
}
