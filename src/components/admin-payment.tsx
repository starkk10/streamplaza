import type { Order, Payment } from "@prisma/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { PAYMENT_STATUS, Pill } from "@/lib/labels";
import { ActionForm, SubmitButton } from "./forms";
import { approvePaymentAction, refundPaymentAction, rejectPaymentAction } from "@/app/admin/actions";

/** Revisión de un comprobante: el empleado confirma el monto que llegó a la cuenta. */
export function PaymentReview({ p, order, tz, canRefund }: { p: Payment; order: Order; tz: string; canRefund: boolean }) {
  const m = (c: number) => formatMoney(c, p.currency);
  const mismatch = p.amountCents !== order.totalCents;
  return (
    <div className="stack-sm" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <div className="row between">
        <span>Operación <span className="mono">{p.reference}</span> · declara {m(p.amountCents)} · {formatDateTime(p.createdAt, tz)}</span>
        <Pill v={PAYMENT_STATUS[p.status]} />
      </div>
      {p.receiptPath && <a className="link small" href={`/api/files/receipts/${p.receiptPath}`} target="_blank" rel="noopener">Abrir comprobante</a>}
      {mismatch && p.status === "EN_REVISION" && <div className="alert warn">El cliente declara {m(p.amountCents)} pero el pedido es de {m(order.totalCents)}.</div>}
      {p.reviewNote && <p className="small muted">Nota: {p.reviewNote}</p>}
      {p.status === "EN_REVISION" && order.status === "PENDIENTE" && (
        <div className="grid-2">
          <ActionForm action={approvePaymentAction} className="form">
            <input type="hidden" name="paymentId" value={p.id} />
            <label className="f">Monto recibido en tu cuenta<input className="in" name="received" inputMode="decimal" required placeholder={(order.totalCents / 100).toFixed(2)} />
              <span className="hint">Revisa tu app de Yape/Plin o el banco. Debe ser {m(order.totalCents)}.</span></label>
            <SubmitButton className="btn green" pendingText="Aprobando…">Aprobar y entregar</SubmitButton>
          </ActionForm>
          <ActionForm action={rejectPaymentAction} className="form">
            <input type="hidden" name="paymentId" value={p.id} />
            <label className="f">Motivo del rechazo<input className="in" name="reason" required minLength={5} placeholder="Ej. El monto no llegó a la cuenta" /></label>
            <SubmitButton className="btn danger" pendingText="Rechazando…">Rechazar</SubmitButton>
          </ActionForm>
        </div>
      )}
      {p.status === "APROBADO" && canRefund && (
        <details>
          <summary className="small muted">Registrar reembolso</summary>
          <ActionForm action={refundPaymentAction} className="form">
            <input type="hidden" name="paymentId" value={p.id} />
            <label className="f">Motivo<input className="in" name="reason" required minLength={5} /></label>
            <span className="hint">Devuelve el dinero por tu medio de pago y luego regístralo aquí. Cancela el pedido y sus suscripciones.</span>
            <SubmitButton className="btn danger sm" confirmText="Confirmar reembolso">Registrar reembolso</SubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
