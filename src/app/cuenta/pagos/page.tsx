import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { formatDateTime, formatMoney, orderCode } from "@/lib/format";
import { PAYMENT_STATUS, Pill } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { Empty, Pager, pageOf, type SP } from "@/components/table";

export const metadata = { title: "Pagos" };

export default async function MyPayments({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser("/cuenta/pagos");
  const { page, skip, take } = pageOf(sp);
  const tz = (await getSettings())["store.timezone"];
  const where = { order: { customerId: user.id } };
  const [total, payments] = await Promise.all([
    db.payment.count({ where }),
    db.payment.findMany({ where, include: { order: true }, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return (
    <>
      <h1>Historial de pagos</h1>
      <div className="card">
        {payments.length ? (
          <>
            <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Pedido</th><th>Operación</th><th>Estado</th><th className="r">Monto</th><th></th></tr></thead><tbody>
              {payments.map(p => (
                <tr key={p.id}>
                  <td>{formatDateTime(p.createdAt, tz)}</td>
                  <td><Link className="link" href={`/cuenta/pedidos/${p.orderId}`}>{orderCode(p.order.number)}</Link></td>
                  <td className="mono">{p.reference}</td>
                  <td><Pill v={PAYMENT_STATUS[p.status]} />{p.status === "RECHAZADO" && p.reviewNote && <span className="sub">{p.reviewNote}</span>}</td>
                  <td className="r">{formatMoney(p.amountCents, p.currency)}</td>
                  <td className="r">{p.status === "APROBADO" && <a className="link" href={`/api/comprobante/${p.orderId}`}>PDF</a>}</td>
                </tr>
              ))}
            </tbody></table></div>
            <Pager base="/cuenta/pagos" sp={sp} total={total} page={page} />
          </>
        ) : <Empty title="Todavía no registraste pagos" />}
      </div>
    </>
  );
}
