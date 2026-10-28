import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { formatDateTime, orderCode } from "@/lib/format";
import { Pill, TICKET_STATUS } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ticketReplyAction } from "../../actions";

export default async function TicketAdmin({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStaffPage("support.manage");
  const tz = (await getSettings())["store.timezone"];
  const t = await db.supportTicket.findUnique({ where: { id }, include: { customer: true, replies: { include: { author: true }, orderBy: { createdAt: "asc" } } } });
  if (!t) notFound();
  const order = t.orderId ? await db.order.findUnique({ where: { id: t.orderId } }) : null;
  return (
    <>
      <Link className="link small" href="/admin/soporte">← Soporte</Link>
      <div className="card">
        <div className="card-head"><div><h2>{t.subject}</h2><p className="muted small"><Link className="link" href={`/admin/clientes/${t.customerId}`}>{t.customer.name}</Link>{order && <> · pedido <Link className="link" href={`/admin/pedidos/${order.id}`}>{orderCode(order.number)}</Link></>}</p></div><Pill v={TICKET_STATUS[t.status]} /></div>
        <div className="chat">
          {t.replies.map(r => (
            <div key={r.id} className={`bubble ${r.authorId === t.customerId ? "in" : "out"}`}><b>{r.author.name}{"\n"}</b>{r.message}<time>{formatDateTime(r.createdAt, tz)}</time></div>
          ))}
        </div>
        <ActionForm action={ticketReplyAction} resetOnSuccess>
          <input type="hidden" name="ticketId" value={t.id} />
          <label className="f">Respuesta<textarea className="in" name="message" /></label>
          <label className="check"><input type="checkbox" name="close" /> Cerrar la consulta</label>
          <SubmitButton pendingText="Guardando…">Enviar</SubmitButton>
        </ActionForm>
      </div>
    </>
  );
}
