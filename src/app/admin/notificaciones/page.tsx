import type { NotificationChannel, NotificationStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { NOTIF_STATUS, Pill } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Empty, Filters, Pager, pageOf, param, type SP } from "@/components/table";
import { retryNotificationAction } from "../actions";

export const metadata = { title: "Notificaciones" };

export default async function Notifications({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireStaffPage("notifications.view");
  const tz = (await getSettings())["store.timezone"];
  const status = param(sp, "estado") as NotificationStatus;
  const channel = param(sp, "canal") as NotificationChannel;
  const q = param(sp, "q");
  const where: Prisma.NotificationWhereInput = {
    ...(status in NOTIF_STATUS ? { status } : {}),
    ...(channel === "EMAIL" || channel === "WHATSAPP" ? { channel } : {}),
    ...(q ? { OR: [{ to: { contains: q } }, { event: { contains: q } }] } : {}),
  };
  const { page, skip, take } = pageOf(sp);
  const [total, rows, counts] = await Promise.all([
    db.notification.count({ where }),
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    db.notification.groupBy({ by: ["status"], _count: true }),
  ]);
  return (
    <>
      <div className="topbar">
        <h1>Notificaciones</h1>
        <ActionForm action={retryNotificationAction} className="row"><SubmitButton className="btn ghost sm" pendingText="Enviando…">Reintentar fallidas y omitidas</SubmitButton></ActionForm>
      </div>
      <div className="row">{counts.map(c => <span key={c.status} className="row small"><Pill v={NOTIF_STATUS[c.status]} /> {c._count}</span>)}</div>
      <Filters base="/admin/notificaciones" sp={sp} placeholder="Destinatario o evento" selects={[
        { name: "estado", label: "Estado", options: Object.entries(NOTIF_STATUS).map(([k, v]) => [k, v[0]]) },
        { name: "canal", label: "Canal", options: [["EMAIL", "Correo"], ["WHATSAPP", "WhatsApp"]] },
      ]} />
      <div className="card">
        {rows.length ? (
          <>
            <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Canal</th><th>Para</th><th>Aviso</th><th>Estado</th><th></th></tr></thead><tbody>
              {rows.map(n => (
                <tr key={n.id}>
                  <td>{formatDateTime(n.createdAt, tz)}</td>
                  <td>{n.channel === "EMAIL" ? "Correo" : "WhatsApp"}</td>
                  <td className="mono small">{n.channel === "WHATSAPP" ? "+" + n.to : n.to}</td>
                  <td>{n.subject}<span className="sub">{n.event}</span></td>
                  <td><Pill v={NOTIF_STATUS[n.status]} />{n.error && <span className="sub">{n.error}</span>}{n.attempts > 0 && <span className="sub">{n.attempts} intentos</span>}</td>
                  <td>{(n.status === "FALLIDA" || n.status === "OMITIDA") && (
                    <ActionForm action={retryNotificationAction} className="row"><input type="hidden" name="id" value={n.id} /><SubmitButton className="btn ghost sm">Reintentar</SubmitButton></ActionForm>
                  )}</td>
                </tr>
              ))}
            </tbody></table></div>
            <Pager base="/admin/notificaciones" sp={sp} total={total} page={page} />
          </>
        ) : <Empty title="No hay avisos con ese filtro" />}
      </div>
    </>
  );
}
