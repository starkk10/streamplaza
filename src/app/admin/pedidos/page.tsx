import Link from "next/link";
import type { OrderChannel, OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { formatDateTime, formatMoney, orderCode } from "@/lib/format";
import { ORDER_STATUS, Pill } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { Empty, Filters, Pager, pageOf, param, SortTh, sortOf, type SP } from "@/components/table";

export const metadata = { title: "Pedidos" };
const BASE = "/admin/pedidos";

export default async function Orders({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireStaffPage("orders.manage");
  const tz = (await getSettings())["store.timezone"];
  const q = param(sp, "q");
  const status = param(sp, "estado") as OrderStatus;
  const channel = param(sp, "canal") as OrderChannel;
  const num = Number(q.replace(/\D/g, ""));
  const where: Prisma.OrderWhereInput = {
    ...(status in ORDER_STATUS ? { status } : {}),
    ...(["WEB", "WHATSAPP", "ADMIN"].includes(channel) ? { channel } : {}),
    ...(q ? { OR: [
      ...(num ? [{ number: num }] : []),
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { customer: { email: { contains: q, mode: "insensitive" } } },
      { customer: { phone: { contains: q.replace(/\D/g, "") || q } } },
    ] } : {}),
  };
  const sort = sortOf(sp, ["createdAt", "totalCents", "number"] as const, ["createdAt", "desc"]);
  const { page, skip, take } = pageOf(sp);
  const [total, orders] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({ where, include: { customer: true, items: true }, orderBy: { [sort.field]: sort.dir }, skip, take }),
  ]);

  return (
    <>
      <h1>Pedidos</h1>
      <Filters base={BASE} sp={sp} placeholder="N.º de pedido, cliente, correo o teléfono" selects={[
        { name: "estado", label: "Estado", options: Object.entries(ORDER_STATUS).map(([k, v]) => [k, v[0]]) },
        { name: "canal", label: "Canal", options: [["WEB", "Web"], ["WHATSAPP", "WhatsApp"], ["ADMIN", "Panel"]] },
      ]} />
      <div className="card">
        {orders.length ? (
          <>
            <div className="table-wrap"><table><thead><tr>
              <SortTh base={BASE} sp={sp} field="number">Pedido</SortTh><th>Cliente</th><th>Productos</th><th>Estado</th>
              <SortTh base={BASE} sp={sp} field="createdAt">Fecha</SortTh><SortTh base={BASE} sp={sp} field="totalCents" className="r">Total</SortTh>
            </tr></thead><tbody>
              {orders.map(o => (
                <tr key={o.id}>
                  <td><Link className="link mono" href={`${BASE}/${o.id}`}>{orderCode(o.number)}</Link><span className="sub">{o.channel}{o.renewalOfId ? " · renovación" : ""}</span></td>
                  <td>{o.customer.name}<span className="sub">{o.customer.email ?? (o.customer.phone ? "+" + o.customer.phone : "")}</span></td>
                  <td>{o.items.map(i => i.productName).join(", ")}</td>
                  <td><Pill v={ORDER_STATUS[o.status]} /></td>
                  <td>{formatDateTime(o.createdAt, tz)}</td>
                  <td className="r">{formatMoney(o.totalCents, o.currency)}</td>
                </tr>
              ))}
            </tbody></table></div>
            <Pager base={BASE} sp={sp} total={total} page={page} />
          </>
        ) : <Empty title="No hay pedidos con ese filtro" />}
      </div>
    </>
  );
}
