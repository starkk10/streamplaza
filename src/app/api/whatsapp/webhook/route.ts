import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { verifyWebhookSignature } from "@/server/channels/whatsapp";
import { handleWhatsAppWebhook } from "@/server/bot";

export const runtime = "nodejs";

// Verificación del webhook al configurarlo en Meta
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (mode === "subscribe" && env.whatsapp.verifyToken && safeEqual(token, env.whatsapp.verifyToken)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

// Mensajes entrantes. Se rechaza todo lo que no venga firmado por Meta.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"))) {
    console.warn("[whatsapp] webhook con firma no válida");
    return new Response("Invalid signature", { status: 401 });
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { return new Response("Bad request", { status: 400 }); }
  try {
    await handleWhatsAppWebhook(payload);
  } catch (e) {
    console.error("[whatsapp] error procesando webhook", e);
  }
  // Responder 200 siempre que la firma sea válida evita reintentos en bucle; los mensajes repetidos se descartan por id
  return NextResponse.json({ ok: true });
}
