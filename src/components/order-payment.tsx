import type { Order, OrderItem, Payment } from "@prisma/client";
import { formatDateTime, formatMoney, orderCode } from "@/lib/format";
import { ORDER_STATUS, PAYMENT_STATUS, Pill } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { submitPaymentAction } from "@/app/(tienda)/actions";
import { ActionForm, SubmitButton } from "./forms";

/** Detalle del pedido con instrucciones de pago QR y formulario del comprobante. */
export async function OrderPayment({ order, token }: { order: Order & { items: OrderItem[]; payments: Payment[] }; token?: string }) {
  const s = await getSettings();
  const tz = s["store.timezone"];
  const m = (c: number) => formatMoney(c, order.currency);
  const inReview = order.payments.some(p => p.status === "EN_REVISION");
  const receiptHref = (p: Payment) => `/api/files/receipts/${p.receiptPath}${token ? `?t=${encodeURIComponent(token)}` : ""}`;

  return (
    <div className="grid-main">
      <div className="card">
        <div className="card-head"><h2>Pedido {orderCode(order.number)}</h2><Pill v={ORDER_STATUS[order.status]} /></div>
        <p className="muted small">Creado el {formatDateTime(order.createdAt, tz)}</p>
        <div className="table-wrap"><table><thead><tr><th>Producto</th><th className="r">Importe</th></tr></thead><tbody>
          {order.items.map(it => <tr key={it.id}><td>{it.productName}<span className="sub">{it.planName} · {it.durationDays} días</span></td><td className="r">{m(it.unitPriceCents)}</td></tr>)}
          {order.discountCents > 0 && <tr><td className="muted">Descuento</td><td className="r">− {m(order.discountCents)}</td></tr>}
          <tr><td><b>Total</b></td><td className="r"><b>{m(order.totalCents)}</b></td></tr>
        </tbody></table></div>
        {order.payments.length > 0 && (
          <div className="stack-sm">
            <h3>Pagos enviados</h3>
            {order.payments.map(p => (
              <div key={p.id} className="row between small">
                <span>Operación <span className="mono">{p.reference}</span> · {m(p.amountCents)} · {formatDateTime(p.createdAt, tz)}{p.receiptPath && <> · <a className="link" href={receiptHref(p)} target="_blank" rel="noopener">ver comprobante</a></>}</span>
                <span className="row"><Pill v={PAYMENT_STATUS[p.status]} />{p.status === "RECHAZADO" && p.reviewNote && <span className="muted">{p.reviewNote}</span>}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        {order.status === "PENDIENTE" ? (
          inReview ? (
            <><h2>Pago en revisión</h2><p className="muted">Recibimos tu comprobante. Te avisaremos por correo o WhatsApp cuando lo aprobemos.</p></>
          ) : (
            <>
              <h2>Paga con QR</h2>
              <p className="prose">{s["payment.instructions"]}</p>
              {s["payment.qrFile"] ? <img className="qr" src={`/api/files/public/${s["payment.qrFile"]}`} alt="Código QR de pago" />
                : <div className="alert warn">La tienda todavía no subió su código QR. Escríbenos para coordinar el pago.</div>}
              {s["payment.holder"] && <p className="small">Titular: <b>{s["payment.holder"]}</b></p>}
              <p>Total a pagar: <span className="price">{m(order.totalCents)}</span></p>
              <ActionForm action={submitPaymentAction} className="form">
                <input type="hidden" name="orderId" value={order.id} />
                {token && <input type="hidden" name="token" value={token} />}
                <label className="f">Número de operación<input className="in" name="reference" required minLength={4} maxLength={40} placeholder="Ej. 12345678" autoComplete="off" /></label>
                <label className="f">Monto pagado<input className="in" name="amount" required inputMode="decimal" defaultValue={(order.totalCents / 100).toFixed(2)} /></label>
                <label className="f">Foto o PDF del comprobante<input className="in" name="receipt" type="file" required accept="image/png,image/jpeg,image/webp,application/pdf" /></label>
                <SubmitButton className="btn green" pendingText="Enviando…">Enviar comprobante</SubmitButton>
              </ActionForm>
            </>
          )
        ) : order.status === "ENTREGADO" ? (
          <><h2>¡Pedido entregado!</h2><p className="muted">Revisa tus accesos e instrucciones en <a className="link" href="/cuenta/suscripciones">Mis suscripciones</a>.</p></>
        ) : order.status === "CANCELADO" ? (
          <><h2>Pedido cancelado</h2><p className="muted">{order.note || "Si crees que es un error, contacta con soporte."}</p></>
        ) : (
          <><h2>Pago aprobado</h2><p className="muted">Estamos preparando tu entrega. Te avisaremos cuando esté lista.</p></>
        )}
      </div>
    </div>
  );
}
