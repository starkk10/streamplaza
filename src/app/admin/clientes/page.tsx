import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { formatDate } from "@/lib/format";
import { getSettings } from "@/server/settings";
import { Empty, Filters, Pager, pageOf, param, SortTh, sortOf, type SP } from "@/components/table";

export const metadata = { title: "Clientes" };
const BASE = "/admin/clientes";

export default async function Customers({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireStaffPage("customers.view");
  const tz = (await getSettings())["store.timezone"];
  const q = param(sp, "q");
  const where: Prisma.UserWhereInput = {
    role: "CLIENTE",
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || q } }] } : {}),
  };
  const sort = sortOf(sp, ["createdAt", "name"] as const, ["createdAt", "desc"]);
  const { page, skip, take } = pageOf(sp);
  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({ where, include: { _count: { select: { orders: true, subscriptions: { where: { status: "ACTIVA" } } } } }, orderBy: { [sort.field]: sort.dir }, skip, take }),
  ]);
  return (
    <>
      <h1>Clientes</h1>
      <Filters base={BASE} sp={sp} placeholder="Nombre, correo o teléfono" />
      <div className="card">
        {users.length ? (
          <>
            <div className="table-wrap"><table><thead><tr><SortTh base={BASE} sp={sp} field="name">Cliente</SortTh><th>Contacto</th><th className="r">Pedidos</th><th className="r">Activas</th><SortTh base={BASE} sp={sp} field="createdAt">Alta</SortTh></tr></thead><tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td><Link className="link" href={`${BASE}/${u.id}`}>{u.name}</Link>{!u.active && <span className="sub">Desactivado</span>}</td>
                  <td>{u.email ?? "—"}<span className="sub">{u.phone ? "+" + u.phone : ""}{!u.passwordHash ? " · solo WhatsApp" : ""}</span></td>
                  <td className="r">{u._count.orders}</td>
                  <td className="r">{u._count.subscriptions}</td>
                  <td>{formatDate(u.createdAt, tz)}</td>
                </tr>
              ))}
            </tbody></table></div>
            <Pager base={BASE} sp={sp} total={total} page={page} />
          </>
        ) : <Empty title="No hay clientes con ese filtro" />}
      </div>
    </>
  );
}
