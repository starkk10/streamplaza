import Link from "next/link";
import { requireStaffPage } from "@/lib/session";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatDate, formatDateTime, formatMoney, orderCode } from "@/lib/format";
import { ORDER_STATUS, Pill } from "@/lib/labels";
import { dashboardAlerts, salesStats, type Period } from "@/server/stats";
import { getSettings } from "@/server/settings";
import { emailConfigured } from "@/server/channels/email";
import { whatsappConfigured } from "@/server/channels/whatsapp";
import { param, type SP } from "@/components/table";

export const metadata = { title: "Dashboard" };

const PERIODS: [Period, string][] = [["dia", "Hoy (24 h)"], ["semana", "7 días"], ["mes", "30 días"]];

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireStaffPage("dashboard.view");
  const period = (PERIODS.find(p => p[0] === param(sp, "periodo"))?.[0] ?? "semana") as Period;
  const s = await getSettings();
  const tz = s["store.timezone"];
  const money = (c: number) => formatMoney(c, s["store.currency"]);
  const [st, alerts, recent] = await Promise.all([
    salesStats(period, tz),
    dashboardAlerts(),
    db.order.findMany({ include: { customer: true, items: true }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const max = Math.max(1, ...st.series.map(x => x.cents));
  const noPerm = param(sp, "sin-permiso") === "1";

  return (
    <>
      <div className="topbar">
        <h1>Dashboard</h1>
        <span className="muted">{formatDateTime(new Date(), tz)}</span>
      </div>
      {noPerm && <div className="alert warn">Tu rol no tiene acceso a esa sección.</div>}

      <div className="big-actions">
        {can(user.role, "licenses.manage") && <Link className="big blue" href="/admin/licencias"><span>Registrar códigos<small>Carga inventario manual o por CSV</small></span></Link>}
        {can(user.role, "payments.review") && <Link className="big green" href="/admin/pagos"><span>Revisar pagos ({alerts.paymentsToReview})<small>Aprueba comprobantes y entrega al instante</small></span></Link>}
      </div>

      {(!s["payment.qrFile"] || !whatsappConfigured() || !emailConfigured()) && can(user.role, "settings.manage") && (
        <div className="card">
          <h2>Completa tu tienda</h2>
          {!s["payment.qrFile"] && <div className="row between"><span>Sube tu QR de cobro (Yape/Plin)</span><Link className="btn sm" href="/admin/configuracion">Subir QR →</Link></div>}
          {!whatsappConfigured() && <div className="row between"><span>Conecta WhatsApp Cloud API para el bot y los avisos</span><Link className="btn sm" href="/admin/configuracion#canales">Ver cómo →</Link></div>}
          {!emailConfigured() && <div className="row between"><span>Configura el correo (SMTP) para enviar avisos</span><Link className="btn sm" href="/admin/configuracion#canales">Ver cómo →</Link></div>}
        </div>
      )}

      <div className="row">
        {PERIODS.map(([k, l]) => <Link key={k} className={`chip ${period === k ? "on" : ""}`} href={`/admin?periodo=${k}`}>{l}</Link>)}
      </div>
      <div className="kpis">
        <div className="kpi ok"><span>Ingresos aprobados</span><b>{money(st.revenueCents)}</b><span>{st.paidCount} pagos</span></div>
        <div className="kpi"><span>Pedidos creados</span><b>{st.ordersTotal}</b><span>{st.ordersByStatus.ENTREGADO ?? 0} entregados · {st.ordersByStatus.CANCELADO ?? 0} cancelados</span></div>
        <div className="kpi"><span>Ticket promedio</span><b>{money(st.paidCount ? Math.round(st.revenueCents / st.paidCount) : 0)}</b><span>por pago aprobado</span></div>
        <div className="kpi"><span>Clientes nuevos</span><b>{st.newCustomers}</b><span>en el periodo</span></div>
      </div>

      <div className="grid-main">
        <div className="card">
          <h2>Ingresos por día <span className="muted small">últimos {st.series.length} días</span></h2>
          <div className="bars" role="img" aria-label="Ingresos aprobados por día">
            {st.series.map(x => <div key={x.day} style={{ height: `${(x.cents / max) * 100}%` }} title={`${formatDate(x.day + "T12:00:00Z", "UTC")}: ${money(x.cents)}`} />)}
          </div>
          <div className="bars-labels"><span>{formatDate(st.series[0].day + "T12:00:00Z", "UTC")}</span><span>máx. {money(max === 1 ? 0 : max)}</span><span>{formatDate(st.series.at(-1)!.day + "T12:00:00Z", "UTC")}</span></div>
        </div>
        <div className="card">
          <h2>Alertas</h2>
          <Alert n={alerts.paymentsToReview} href="/admin/pagos" text="comprobantes por revisar" tone="warn" />
          <Alert n={alerts.ordersToDeliver} href="/admin/pedidos?estado=PROCESADO" text="pedidos pagados sin entregar" tone="crit" />
          <Alert n={alerts.expiringSoon} href="/admin/suscripciones?vence=3" text="suscripciones vencen en 3 días" tone="warn" />
          <Alert n={alerts.lowStock.length} href="/admin/licencias" text={`productos con poco stock${alerts.lowStock.length ? ": " + alerts.lowStock.map(p => `${p.name} (${p.available})`).join(", ") : ""}`} tone="crit" />
          <Alert n={alerts.handoffs} href="/admin/whatsapp" text="chats esperan a un asesor" tone="warn" />
          <Alert n={alerts.openTickets} href="/admin/soporte" text="consultas de soporte abiertas" tone="warn" />
          <Alert n={alerts.failedNotifications} href="/admin/notificaciones?estado=FALLIDA" text="avisos fallidos" tone="crit" />
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Últimos pedidos</h2><Link className="link small" href="/admin/pedidos">Ver todos</Link></div>
        {recent.length ? (
          <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Productos</th><th>Estado</th><th className="r">Total</th></tr></thead><tbody>
            {recent.map(o => (
              <tr key={o.id}>
                <td><Link className="link mono" href={`/admin/pedidos/${o.id}`}>{orderCode(o.number)}</Link><span className="sub">{formatDateTime(o.createdAt, tz)}</span></td>
                <td>{o.customer.name}<span className="sub">{o.channel}</span></td>
                <td>{o.items.map(i => i.productName).join(", ")}</td>
                <td><Pill v={ORDER_STATUS[o.status]} /></td>
                <td className="r">{formatMoney(o.totalCents, o.currency)}</td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <div className="empty"><b>Todavía no hay pedidos</b>Cuando un cliente compre en la tienda o por WhatsApp aparecerá aquí.</div>}
      </div>
    </>
  );
}

function Alert({ n, href, text, tone }: { n: number; href: string; text: string; tone: "warn" | "crit" }) {
  return (
    <Link href={href} className="row between" style={{ textDecoration: "none", opacity: n ? 1 : 0.55 }}>
      <span>{text}</span><span className={`pill ${n ? tone : "mute"}`}>{n}</span>
    </Link>
  );
}
