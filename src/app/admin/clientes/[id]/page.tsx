import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { daysLeft, formatDate, formatDateTime, formatMoney, orderCode } from "@/lib/format";
import { DaysPill, ORDER_STATUS, PAYMENT_STATUS, Pill, SUB_STATUS, TICKET_STATUS } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { toggleCustomerAction } from "../../actions";

export default async function Customer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaffPage("customers.view");
  const tz = (await getSettings())["store.timezone"];
  const c = await db.user.findUnique({
    where: { id },
    include: {
      orders: { include: { items: true, payments: true }, orderBy: { createdAt: "desc" } },
      subscriptions: { include: { product: true, plan: true, events: { orderBy: { createdAt: "desc" } } }, orderBy: { endAt: "desc" } },
      tickets: { orderBy: { updatedAt: "desc" } },
      conversation: true,
    },
  });
  if (!c) notFound();
  const paid = c.orders.flatMap(o => o.payments).filter(p => p.status === "APROBADO").reduce((a, p) => a + p.amountCents, 0);
  const currency = c.orders[0]?.currency ?? (await getSettings())["store.currency"];

  return (
    <>
      <Link className="link small" href="/admin/clientes">← Clientes</Link>
      <div className="topbar">
        <h1>{c.name} {!c.active && <span className="pill mute">Desactivado</span>}</h1>
        {can(user.role, "users.manage") && (
          <ActionForm action={toggleCustomerAction} className="row"><input type="hidden" name="id" value={c.id} />
            <SubmitButton className={c.active ? "btn danger sm" : "btn sm"} confirmText="Confirmar">{c.active ? "Desactivar cuenta" : "Activar cuenta"}</SubmitButton>
          </ActionForm>
        )}
      </div>
      <div className="kpis">
        <div className="kpi"><span>Total pagado</span><b>{formatMoney(paid, currency)}</b></div>
        <div className="kpi"><span>Pedidos</span><b>{c.orders.length}</b></div>
        <div className="kpi ok"><span>Suscripciones activas</span><b>{c.subscriptions.filter(s => s.status === "ACTIVA").length}</b></div>
        <div className="kpi"><span>Cliente desde</span><b style={{ fontSize: 18 }}>{formatDate(c.createdAt, tz)}</b></div>
      </div>
      <div className="card">
        <p className="small">{c.email ?? "Sin correo"} · {c.phone ? `WhatsApp +${c.phone}` : "Sin WhatsApp"} · avisos: {[c.notifyEmail && "correo", c.notifyWhatsapp && "WhatsApp"].filter(Boolean).join(" y ") || "ninguno"}</p>
        {c.conversation && <Link className="link small" href={`/admin/whatsapp?c=${c.conversation.id}`}>Ver conversación de WhatsApp</Link>}
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Suscripciones</h2>
          {c.subscriptions.length ? c.subscriptions.map(s => (
            <div key={s.id} className="stack-sm">
              <div className="row between"><b>{s.product.name} · {s.plan.name}</b><span className="row"><Pill v={SUB_STATUS[s.status]} />{s.status === "ACTIVA" && <DaysPill days={daysLeft(s.endAt, tz)} />}</span></div>
              <span className="hint">{formatDate(s.startAt, tz)} → {formatDate(s.endAt, tz)}</span>
              {s.events.length > 0 && <ul className="small muted">{s.events.map(e => <li key={e.id}>{formatDate(e.createdAt, tz)} · {e.type} · {e.detail}</li>)}</ul>}
            </div>
          )) : <p className="muted small">Sin suscripciones.</p>}
        </div>
        <div className="card">
          <h2>Pedidos y pagos</h2>
          {c.orders.length ? c.orders.map(o => (
            <div key={o.id} className="stack-sm">
              <div className="row between"><Link className="link mono" href={`/admin/pedidos/${o.id}`}>{orderCode(o.number)}</Link><span className="row"><Pill v={ORDER_STATUS[o.status]} /><span className="num">{formatMoney(o.totalCents, o.currency)}</span></span></div>
              <span className="hint">{formatDateTime(o.createdAt, tz)} · {o.items.map(i => i.productName).join(", ")}</span>
              {o.payments.map(p => <span key={p.id} className="small">Pago {p.reference} · <Pill v={PAYMENT_STATUS[p.status]} /></span>)}
            </div>
          )) : <p className="muted small">Sin pedidos.</p>}
        </div>
      </div>
      {c.tickets.length > 0 && (
        <div className="card"><h2>Soporte</h2>
          {c.tickets.map(t => <Link key={t.id} href={`/admin/soporte/${t.id}`} className="row between" style={{ textDecoration: "none" }}><span>{t.subject}</span><Pill v={TICKET_STATUS[t.status]} /></Link>)}
        </div>
      )}
    </>
  );
}
