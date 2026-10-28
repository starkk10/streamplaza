import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/server/settings";
import { whatsappConfigured } from "@/server/channels/whatsapp";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Empty, param, type SP } from "@/components/table";
import { waHandoffAction, waReplyAction } from "../actions";

export const metadata = { title: "WhatsApp" };

export default async function WhatsApp({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireStaffPage("whatsapp.manage");
  const tz = (await getSettings())["store.timezone"];
  const convs = await db.conversation.findMany({ include: { user: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: [{ handoff: "desc" }, { updatedAt: "desc" }], take: 50 });
  const selectedId = param(sp, "c") || convs[0]?.id;
  const sel = selectedId ? await db.conversation.findUnique({ where: { id: selectedId }, include: { user: true, messages: { orderBy: { createdAt: "desc" }, take: 60 } } }) : null;
  const inWindow = !!sel?.lastInboundAt && Date.now() - sel.lastInboundAt.getTime() < 24 * 3600_000;

  return (
    <>
      <h1>WhatsApp</h1>
      {!whatsappConfigured() && <div className="alert warn">WhatsApp Cloud API no está conectado: el bot registra los mensajes, pero no puede responder. Agrega las credenciales en el archivo .env (ver Configuración → Canales).</div>}
      <div className="grid-main" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr)" }}>
        <div className="card">
          <h2>Conversaciones</h2>
          {convs.length ? convs.map(c => (
            <Link key={c.id} href={`/admin/whatsapp?c=${c.id}`} className="stack-sm" style={{ textDecoration: "none", padding: 8, borderRadius: 10, background: c.id === selectedId ? "var(--panel-2)" : undefined }}>
              <span className="row between"><b>{c.user?.name ?? "+" + c.waId}</b>{c.handoff && <span className="pill warn">Asesor</span>}</span>
              <span className="hint">{c.messages[0]?.body.slice(0, 70) ?? ""}</span>
            </Link>
          )) : <Empty title="Sin conversaciones">Cuando un cliente escriba a tu número aparecerá aquí.</Empty>}
        </div>
        {sel ? (
          <div className="card">
            <div className="card-head">
              <div><h2>{sel.user?.name ?? "Cliente"}</h2><p className="muted small">+{sel.waId} · {sel.handoff ? "Atendido por una persona" : `Bot (estado ${sel.state})`}</p></div>
              <ActionForm action={waHandoffAction} className="row">
                <input type="hidden" name="conversationId" value={sel.id} />
                <input type="hidden" name="on" value={sel.handoff ? "0" : "1"} />
                <SubmitButton className="btn ghost sm">{sel.handoff ? "Devolver al bot" : "Tomar conversación"}</SubmitButton>
              </ActionForm>
            </div>
            {sel.user && <Link className="link small" href={`/admin/clientes/${sel.user.id}`}>Ver ficha del cliente</Link>}
            <div className="chat">
              {sel.messages.slice().reverse().map(m => (
                <div key={m.id} className={`bubble ${m.direction === "IN" ? "in" : "out"}`}>{m.body}<time>{formatDateTime(m.createdAt, tz)}</time></div>
              ))}
            </div>
            {inWindow ? (
              <ActionForm action={waReplyAction} resetOnSuccess>
                <input type="hidden" name="conversationId" value={sel.id} />
                <label className="f">Responder<textarea className="in" name="message" required style={{ minHeight: 70 }} /></label>
                <SubmitButton pendingText="Enviando…">Enviar por WhatsApp</SubmitButton>
              </ActionForm>
            ) : <p className="hint">Pasaron más de 24 h desde el último mensaje del cliente. WhatsApp solo permite escribirle con una plantilla aprobada.</p>}
          </div>
        ) : <div className="card"><Empty title="Elige una conversación" /></div>}
      </div>
    </>
  );
}
