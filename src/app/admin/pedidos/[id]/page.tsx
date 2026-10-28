import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatDate, formatDateTime, formatMoney, orderCode } from "@/lib/format";
import { LICENSE_STATUS, ORDER_STATUS, Pill } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { orderLink } from "@/server/orders";
import { PaymentReview } from "@/components/admin-payment";
import { ActionForm, CopyButton, SubmitButton } from "@/components/forms";
import { cancelOrderAction, manualDeliveryAction, retryDeliveryAction } from "../../actions";

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaffPage("orders.manage");
  const tz = (await getSettings())["store.timezone"];
  const o = await db.order.findUnique({
    where: { id },
    include: {
      customer: true, coupon: true, renewalOf: { include: { product: true } },
      items: { include: { license: true, subscription: true, plan: { include: { product: true } } } },
      payments: { orderBy: { createdAt: "desc" }, include: { reviewedBy: true } },
    },
  });
  if (!o) notFound();
  const logs = await db.auditLog.findMany({ where: { OR: [{ entityId: o.id }, { entityId: { in: o.payments.map(p => p.id) } }] }, include: { actor: true }, orderBy: { createdAt: "desc" }, take: 30 });
  const m = (c: number) => formatMoney(c, o.currency);

  return (
    <>
      <Link className="link small" href="/admin/pedidos">← Pedidos</Link>
      <div className="topbar">
        <h1>Pedido {orderCode(o.number)} <Pill v={ORDER_STATUS[o.status]} /></h1>
        <div className="row">
          {o.status !== "PENDIENTE" && <a className="btn ghost sm" href={`/api/comprobante/${o.id}`}>Comprobante PDF</a>}
          <CopyButton text={orderLink(o.accessToken)} label="Copiar enlace de pago" />
        </div>
      </div>

      <div className="grid-main">
        <div className="card">
          <h2>Productos</h2>
          {o.renewalOf && <div className="alert info">Renovación de la suscripción de {o.renewalOf.product.name} (vence {formatDate(o.renewalOf.endAt, tz)}).</div>}
          <div className="table-wrap"><table><thead><tr><th>Producto</th><th>Entrega</th><th className="r">Precio</th></tr></thead><tbody>
            {o.items.map(it => (
              <tr key={it.id}>
                <td>{it.productName}<span className="sub">{it.planName} · {it.durationDays} días</span></td>
                <td>
                  {it.license && <span className="row"><Pill v={LICENSE_STATUS[it.license.status]} /><span className="mono small">…{it.license.last4}</span></span>}
                  {it.deliveredAt ? <span className="sub">Entregado {formatDateTime(it.deliveredAt, tz)}{it.subscription ? ` · vence ${formatDate(it.subscription.endAt, tz)}` : ""}</span>
                    : !o.renewalOf && it.plan.product.deliveryType === "MANUAL" && (o.status === "PAGADO" || o.status === "PROCESADO") ? (
                      <ActionForm action={manualDeliveryAction} className="form">
                        <input type="hidden" name="itemId" value={it.id} />
                        <textarea className="in" name="note" required placeholder="Datos de acceso o nota para el cliente" style={{ minHeight: 70 }} />
                        <SubmitButton className="btn sm green" pendingText="Entregando…">Registrar entrega</SubmitButton>
                      </ActionForm>
                    ) : <span className="sub">{o.status === "PENDIENTE" ? "Esperando pago" : o.status === "CANCELADO" ? "—" : "Pendiente"}</span>}
                  {it.deliveryNote && <span className="sub">Nota: {it.deliveryNote}</span>}
                </td>
                <td className="r">{m(it.unitPriceCents)}</td>
              </tr>
            ))}
            <tr><td colSpan={2} className="muted">Subtotal</td><td className="r">{m(o.subtotalCents)}</td></tr>
            {o.discountCents > 0 && <tr><td colSpan={2} className="muted">Descuento {o.coupon ? `(${o.coupon.code})` : ""}</td><td className="r">− {m(o.discountCents)}</td></tr>}
            <tr><td colSpan={2}><b>Total</b></td><td className="r"><b>{m(o.totalCents)}</b></td></tr>
          </tbody></table></div>
          {o.status === "PROCESADO" && (
            <ActionForm action={retryDeliveryAction} className="row">
              <input type="hidden" name="orderId" value={o.id} />
              <SubmitButton className="btn" pendingText="Entregando…">Reintentar entrega</SubmitButton>
              <span className="hint">Úsalo después de cargar más códigos.</span>
            </ActionForm>
          )}

          <h2>Pagos</h2>
          {o.payments.length ? o.payments.map(p => (
            <div key={p.id}>
              <PaymentReview p={p} order={o} tz={tz} canRefund={can(user.role, "payments.refund")} />
              {p.reviewedBy && <p className="hint">Revisado por {p.reviewedBy.name} · {formatDateTime(p.reviewedAt, tz)}</p>}
            </div>
          )) : <p className="muted small">El cliente todavía no envió un comprobante.</p>}
        </div>

        <div className="stack">
          <div className="card">
            <h2>Cliente</h2>
            <p><Link className="link" href={`/admin/clientes/${o.customer.id}`}>{o.customer.name}</Link></p>
            {o.customer.email && <p className="small">{o.customer.email}</p>}
            {o.customer.phone && <p className="small">WhatsApp: +{o.customer.phone}</p>}
            <p className="small muted">Canal: {o.channel} · creado {formatDateTime(o.createdAt, tz)}</p>
            {o.note && <p className="small muted">{o.note}</p>}
          </div>
          {o.status === "PENDIENTE" && (
            <div className="card">
              <h2>Cancelar pedido</h2>
              <ActionForm action={cancelOrderAction}>
                <input type="hidden" name="orderId" value={o.id} />
                <label className="f">Motivo<input className="in" name="reason" required minLength={3} /></label>
                <SubmitButton className="btn danger" confirmText="Confirmar cancelación">Cancelar y liberar stock</SubmitButton>
              </ActionForm>
            </div>
          )}
          <div className="card">
            <h2>Historial del pedido</h2>
            {logs.length ? logs.map(l => <p key={l.id} className="small"><span className="muted">{formatDateTime(l.createdAt, tz)}</span> · {l.action} · {l.actor?.name ?? "Sistema"}</p>) : <p className="muted small">Sin registros.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
