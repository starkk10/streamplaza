import Link from "next/link";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { decrypt } from "@/lib/crypto";
import { daysLeft, formatDate, formatMoney, orderCode } from "@/lib/format";
import { DaysPill, Pill, SUB_STATUS } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { ActionForm, CopyButton, SubmitButton } from "@/components/forms";
import { Empty } from "@/components/table";
import { renewAction } from "../actions";

export const metadata = { title: "Mis suscripciones" };

export default async function MySubscriptions() {
  const user = await requireUser("/cuenta/suscripciones");
  const s = await getSettings();
  const tz = s["store.timezone"];
  const subs = await db.subscription.findMany({
    where: { customerId: user.id },
    include: {
      product: { include: { plans: { where: { active: true }, orderBy: { durationDays: "asc" } } } }, plan: true, license: true,
      orderItem: { include: { order: true } }, events: { orderBy: { createdAt: "desc" }, take: 5 },
      renewalOrders: { where: { status: { in: ["PENDIENTE", "PAGADO", "PROCESADO"] } } },
    },
    orderBy: [{ status: "asc" }, { endAt: "asc" }],
  });

  return (
    <>
      <h1>Mis suscripciones</h1>
      {subs.length ? subs.map(x => {
        const d = daysLeft(x.endAt, tz);
        const open = x.renewalOrders[0];
        return (
          <div key={x.id} className="card">
            <div className="card-head">
              <div><h2>{x.product.name}</h2><p className="muted small">{x.plan.name} · desde {formatDate(x.startAt, tz)} · vence {formatDate(x.endAt, tz)}</p></div>
              <div className="row"><Pill v={SUB_STATUS[x.status]} />{x.status === "ACTIVA" && <DaysPill days={d} />}</div>
            </div>
            {x.status !== "CANCELADA" && (
              <div className="grid-2">
                <div className="stack-sm">
                  {x.license && <div><span className="hint">Tu código de acceso</span><div className="row"><span className="code-box">{decrypt(x.license.codeEnc)}</span><CopyButton text={decrypt(x.license.codeEnc)} /></div></div>}
                  {x.orderItem.deliveryNote && <div><span className="hint">Datos de entrega</span><p className="prose">{x.orderItem.deliveryNote}</p></div>}
                  {x.product.instructions && <div><span className="hint">Instrucciones de uso</span><p className="prose">{x.product.instructions}</p></div>}
                </div>
                <div className="stack-sm">
                  {open ? (
                    <div className="alert info">Renovación en curso: <Link className="link" href={`/cuenta/pedidos/${open.id}`}>pedido {orderCode(open.number)}</Link></div>
                  ) : x.product.plans.length > 0 && x.product.active ? (
                    <ActionForm action={renewAction} className="form">
                      <input type="hidden" name="subscriptionId" value={x.id} />
                      <input type="hidden" name="key" value={randomUUID()} />
                      <label className="f">Renovar con el plan
                        <select className="in" name="planId" defaultValue={x.product.plans.find(p => p.id === x.planId)?.id ?? x.product.plans[0].id}>
                          {x.product.plans.map(p => <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.priceCents, s["store.currency"])} · +{p.durationDays} días</option>)}
                        </select>
                      </label>
                      <SubmitButton className="btn green" pendingText="Creando pedido…">Renovar</SubmitButton>
                      <span className="hint">Los días se suman a tu fecha de vencimiento actual.</span>
                    </ActionForm>
                  ) : <p className="muted small">Este producto ya no se puede renovar.</p>}
                </div>
              </div>
            )}
            {x.events.length > 0 && (
              <details><summary className="small muted">Historial</summary>
                <ul className="small muted">{x.events.map(e => <li key={e.id}>{formatDate(e.createdAt, tz)} · {e.type} · {e.detail}</li>)}</ul>
              </details>
            )}
          </div>
        );
      }) : <div className="card"><Empty title="Todavía no tienes suscripciones"><Link className="link" href="/">Elige un producto en la tienda</Link></Empty></div>}
    </>
  );
}
