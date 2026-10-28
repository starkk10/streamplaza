import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { formatDate, formatMoney, orderCode } from "@/lib/format";
import { ORDER_STATUS, Pill } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { Empty, Pager, pageOf, type SP } from "@/components/table";

export const metadata = { title: "Mis pedidos" };

export default async function MyOrders({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser("/cuenta/pedidos");
  const { page, skip, take } = pageOf(sp);
  const tz = (await getSettings())["store.timezone"];
  const [total, orders] = await Promise.all([
    db.order.count({ where: { customerId: user.id } }),
    db.order.findMany({ where: { customerId: user.id }, include: { items: true }, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return (
    <>
      <h1>Mis pedidos</h1>
      <div className="card">
        {orders.length ? (
          <>
            <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Productos</th><th>Fecha</th><th>Estado</th><th className="r">Total</th><th></th></tr></thead><tbody>
              {orders.map(o => (
                <tr key={o.id}>
                  <td className="mono">{orderCode(o.number)}</td>
                  <td>{o.items.map(i => i.productName).join(", ")}{o.renewalOfId && <span className="sub">Renovación</span>}</td>
                  <td>{formatDate(o.createdAt, tz)}</td>
                  <td><Pill v={ORDER_STATUS[o.status]} /></td>
                  <td className="r">{formatMoney(o.totalCents, o.currency)}</td>
                  <td className="r"><Link className="link" href={`/cuenta/pedidos/${o.id}`}>{o.status === "PENDIENTE" ? "Pagar" : "Ver"}</Link></td>
                </tr>
              ))}
            </tbody></table></div>
            <Pager base="/cuenta/pedidos" sp={sp} total={total} page={page} />
          </>
        ) : <Empty title="Aún no tienes pedidos"><Link className="link" href="/">Ir a la tienda</Link></Empty>}
      </div>
    </>
  );
}
