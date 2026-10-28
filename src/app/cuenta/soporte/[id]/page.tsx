import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { Pill, TICKET_STATUS } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { replyTicketAction } from "../../actions";

export default async function Ticket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/cuenta/soporte/${id}`);
  const t = await db.supportTicket.findUnique({ where: { id }, include: { replies: { include: { author: true }, orderBy: { createdAt: "asc" } } } });
  if (!t || t.customerId !== user.id) notFound();
  const tz = (await getSettings())["store.timezone"];
  return (
    <>
      <Link className="link small" href="/cuenta/soporte">← Soporte</Link>
      <div className="card">
        <div className="card-head"><h2>{t.subject}</h2><Pill v={TICKET_STATUS[t.status]} /></div>
        <div className="chat">
          {t.replies.map(r => (
            <div key={r.id} className={`bubble ${r.authorId === user.id ? "out" : "in"}`}>
              {r.authorId !== user.id && <b>{r.author.name} · Soporte{"\n"}</b>}{r.message}
              <time>{formatDateTime(r.createdAt, tz)}</time>
            </div>
          ))}
        </div>
        {t.status !== "CERRADO" ? (
          <ActionForm action={replyTicketAction} resetOnSuccess>
            <input type="hidden" name="ticketId" value={t.id} />
            <label className="f">Tu mensaje<textarea className="in" name="message" required /></label>
            <SubmitButton pendingText="Enviando…">Responder</SubmitButton>
          </ActionForm>
        ) : <p className="muted small">Esta consulta está cerrada.</p>}
      </div>
    </>
  );
}
