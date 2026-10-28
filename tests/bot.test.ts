import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/whatsapp/webhook/route";
import { resetDb, seedBasics } from "./helpers";

afterAll(async () => { await db.$disconnect(); });
beforeEach(async () => { await resetDb(); await seedBasics(); });

let n = 0;
function payload(text: string, from = "51955555555") {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ value: {
    contacts: [{ wa_id: from, profile: { name: "Carlos Prueba" } }],
    messages: [{ id: `wamid.${++n}`, from, type: "text", text: { body: text } }],
  } }] }] };
}

function signed(body: unknown, secret = "wa-app-secret") {
  const raw = JSON.stringify(body);
  return new Request("http://localhost/api/whatsapp/webhook", {
    method: "POST", body: raw,
    headers: { "x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") },
  });
}

describe("webhook de WhatsApp", () => {
  it("verifica el token al suscribir el webhook", async () => {
    const ok = await GET(new Request("http://x/api?hub.mode=subscribe&hub.verify_token=wa-verify&hub.challenge=123"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("123");
    expect((await GET(new Request("http://x/api?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1"))).status).toBe(403);
  });

  it("rechaza mensajes sin firma válida de Meta", async () => {
    expect((await POST(signed(payload("hola"), "secreto-falso"))).status).toBe(401);
    expect(await db.conversation.count()).toBe(0);
  });

  it("guía la compra completa y crea el pedido", async () => {
    for (const t of ["hola", "1", "1", "2", "1"]) expect((await POST(signed(payload(t)))).status).toBe(200);
    const order = await db.order.findFirstOrThrow({ include: { items: true, customer: true } });
    expect(order.channel).toBe("WHATSAPP");
    expect(order.items[0].planName).toBe("3 meses");
    expect(order.totalCents).toBe(4000);
    expect(order.customer.phone).toBe("51955555555");
    const out = await db.conversationMessage.findMany({ where: { direction: "OUT" }, orderBy: { createdAt: "asc" } });
    expect(out.at(-1)?.body).toContain("/pedido/" + order.accessToken);
  });

  it("no procesa dos veces el mismo mensaje reenviado por Meta", async () => {
    const p = payload("hola");
    await POST(signed(p));
    await POST(signed(p));
    expect(await db.conversationMessage.count({ where: { direction: "IN" } })).toBe(1);
  });

  it("pasa la conversación a una persona y deja de responder", async () => {
    await POST(signed(payload("3")));
    const conv = await db.conversation.findFirstOrThrow();
    expect(conv.handoff).toBe(true);
    const before = await db.conversationMessage.count({ where: { direction: "OUT" } });
    await POST(signed(payload("1")));
    expect(await db.conversationMessage.count({ where: { direction: "OUT" } })).toBe(before);
    await POST(signed(payload("menu")));
    expect((await db.conversation.findFirstOrThrow()).handoff).toBe(false);
  });

  it("informa el estado de los pedidos", async () => {
    for (const t of ["1", "1", "1", "1"]) await POST(signed(payload(t)));
    await POST(signed(payload("2")));
    const last = await db.conversationMessage.findFirstOrThrow({ where: { direction: "OUT" }, orderBy: { createdAt: "desc" } });
    expect(last.body).toContain("pendiente de pago");
  });
});
