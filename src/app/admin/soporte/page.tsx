import Link from "next/link";
import type { TicketStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { Pill, TICKET_STATUS } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { Empty, Filters, Pager, pageOf, param, type SP } from "@/components/table";

export const metadata = { title: "Soporte" };

export default async function SupportAdmin({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireStaffPage("support.manage");
  const tz = (await getSettings())["store.timezone"];
  const status = param(sp, "estado") as TicketStatus;
  const q = param(sp, "q");
  const where = {
    ...(status in TICKET_STATUS ? { status } : {}),
    ...(q ? { OR: [{ subject: { contains: q, mode: "insensitive" as const } }, { customer: { name: { contains: q, mode: "insensitive" as const } } }] } : {}),
  };
  const { page, skip, take } = pageOf(sp);
  const [total, tickets] = await Promise.all([
    db.supportTicket.count({ where }),
    db.supportTicket.findMany({ where, include: { customer: true, _count: { select: { replies: true } } }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], skip, take }),
  ]);
  return (
    <>
      <h1>Soporte</h1>
      <Filters base="/admin/soporte" sp={sp} placeholder="Asunto o cliente" selects={[{ name: "estado", label: "Estado", options: Object.entries(TICKET_STATUS).map(([k, v]) => [k, v[0]]) }]} />
      <div className="card">
        {tickets.length ? (
          <>
            <div className="table-wrap"><table><thead><tr><th>Asunto</th><th>Cliente</th><th>Estado</th><th className="r">Mensajes</th><th>Actualizado</th></tr></thead><tbody>
              {tickets.map(t => (
                <tr key={t.id}>
                  <td><Link className="link" href={`/admin/soporte/${t.id}`}>{t.subject}</Link></td>
                  <td>{t.customer.name}</td>
                  <td><Pill v={TICKET_STATUS[t.status]} /></td>
                  <td className="r">{t._count.replies}</td>
                  <td>{formatDateTime(t.updatedAt, tz)}</td>
                </tr>
              ))}
            </tbody></table></div>
            <Pager base="/admin/soporte" sp={sp} total={total} page={page} />
          </>
        ) : <Empty title="No hay consultas con ese filtro" />}
      </div>
    </>
  );
}
