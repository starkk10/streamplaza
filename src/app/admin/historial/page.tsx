import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/server/settings";
import { Empty, Filters, Pager, pageOf, param, type SP } from "@/components/table";

export const metadata = { title: "Historial" };

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireStaffPage("audit.view");
  const tz = (await getSettings())["store.timezone"];
  const q = param(sp, "q");
  const entity = param(sp, "entidad");
  const where: Prisma.AuditLogWhereInput = {
    ...(entity ? { entity } : {}),
    ...(q ? { OR: [{ action: { contains: q } }, { entityId: q }, { actor: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const { page, skip, take } = pageOf(sp);
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, include: { actor: true }, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return (
    <>
      <h1>Historial de operaciones</h1>
      <Filters base="/admin/historial" sp={sp} placeholder="Acción, id o persona" selects={[{ name: "entidad", label: "Tipo", options: [["Order", "Pedidos"], ["Payment", "Pagos"], ["License", "Licencias"], ["Subscription", "Suscripciones"], ["Product", "Productos"], ["User", "Usuarios"], ["Setting", "Configuración"], ["Conversation", "WhatsApp"]] }]} />
      <div className="card">
        {rows.length ? (
          <>
            <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Persona</th><th>Acción</th><th>Elemento</th><th>Detalle</th></tr></thead><tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.createdAt, tz)}</td>
                  <td>{r.actor?.name ?? "Sistema"}</td>
                  <td className="mono small">{r.action}</td>
                  <td className="small">{r.entity}<span className="sub mono">{r.entityId}</span></td>
                  <td className="small mono">{r.detail ? JSON.stringify(r.detail).slice(0, 160) : ""}</td>
                </tr>
              ))}
            </tbody></table></div>
            <Pager base="/admin/historial" sp={sp} total={total} page={page} />
          </>
        ) : <Empty title="Sin registros" />}
      </div>
    </>
  );
}
