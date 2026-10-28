import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { formatDateTime, orderCode } from "@/lib/format";
import { Pill, TICKET_STATUS } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Empty, param, type SP } from "@/components/table";
import { createTicketAction } from "../actions";

export const metadata = { title: "Soporte" };

export default async function Support({ searchParams }: { searchParams: Promise<SP> }) {
  const orderId = param(await searchParams, "pedido");
  const user = await requireUser("/cuenta/soporte");
  const s = await getSettings();
  const [tickets, orders] = await Promise.all([
    db.supportTicket.findMany({ where: { customerId: user.id }, orderBy: { updatedAt: "desc" } }),
    db.order.findMany({ where: { customerId: user.id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return (
    <>
      <h1>Soporte</h1>
      <div className="grid-2">
        <div className="card">
          <h2>Nueva consulta</h2>
          <ActionForm action={createTicketAction}>
            <label className="f">Asunto<input className="in" name="subject" required minLength={4} maxLength={120} /></label>
            <label className="f">Pedido relacionado (opcional)
              <select className="in" name="orderId" defaultValue={orderId}>
                <option value="">Ninguno</option>
                {orders.map(o => <option key={o.id} value={o.id}>{orderCode(o.number)}</option>)}
              </select>
            </label>
            <label className="f">Mensaje<textarea className="in" name="message" required minLength={10} maxLength={4000} /></label>
            <SubmitButton pendingText="Enviando…">Enviar consulta</SubmitButton>
          </ActionForm>
          {(s["store.supportWhatsapp"] || s["store.supportEmail"]) && (
            <p className="hint">También puedes escribirnos {s["store.supportWhatsapp"] && <>por WhatsApp al +{s["store.supportWhatsapp"].replace(/\D/g, "")}</>} {s["store.supportEmail"] && <>o a {s["store.supportEmail"]}</>}.</p>
          )}
        </div>
        <div className="card">
          <h2>Tus consultas</h2>
          {tickets.length ? tickets.map(t => (
            <Link key={t.id} href={`/cuenta/soporte/${t.id}`} className="row between" style={{ textDecoration: "none" }}>
              <span><b>{t.subject}</b><span className="hint" style={{ display: "block" }}>{formatDateTime(t.updatedAt, s["store.timezone"])}</span></span>
              <Pill v={TICKET_STATUS[t.status]} />
            </Link>
          )) : <Empty title="No tienes consultas" />}
        </div>
      </div>
    </>
  );
}
