import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { daysLeft, formatDate, formatMoney, orderCode } from "@/lib/format";
import { DaysPill, ORDER_STATUS, Pill } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { Empty } from "@/components/table";

export const metadata = { title: "Mi cuenta" };

export default async function AccountHome() {
  const user = await requireUser();
  const s = await getSettings();
  const tz = s["store.timezone"];
  const [subs, orders] = await Promise.all([
    db.subscription.findMany({ where: { customerId: user.id, status: "ACTIVA" }, include: { product: true, plan: true }, orderBy: { endAt: "asc" } }),
    db.order.findMany({ where: { customerId: user.id }, include: { items: true }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const soon = subs.filter(x => daysLeft(x.endAt, tz) <= 3);

  return (
    <>
      <div className="topbar"><h1>Hola, {user.name.split(" ")[0]}</h1></div>
      {soon.length > 0 && <div className="alert warn">Tienes {soon.length} {soon.length === 1 ? "suscripción que vence" : "suscripciones que vencen"} en 3 días o menos. <Link className="link" href="/cuenta/suscripciones">Renovar</Link></div>}
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Suscripciones activas</h2><Link className="link small" href="/cuenta/suscripciones">Ver todas</Link></div>
          {subs.length ? subs.map(x => (
            <div key={x.id} className="row between">
              <span><b>{x.product.name}</b><span className="hint" style={{ display: "block" }}>{x.plan.name} · vence {formatDate(x.endAt, tz)}</span></span>
              <DaysPill days={daysLeft(x.endAt, tz)} />
            </div>
          )) : <Empty title="No tienes suscripciones activas"><Link className="link" href="/">Ver la tienda</Link></Empty>}
        </div>
        <div className="card">
          <div className="card-head"><h2>Pedidos recientes</h2><Link className="link small" href="/cuenta/pedidos">Ver todos</Link></div>
          {orders.length ? orders.map(o => (
            <Link key={o.id} href={`/cuenta/pedidos/${o.id}`} className="row between" style={{ textDecoration: "none" }}>
              <span><b>{orderCode(o.number)}</b><span className="hint" style={{ display: "block" }}>{o.items.map(i => i.productName).join(", ")} · {formatMoney(o.totalCents, o.currency)}</span></span>
              <Pill v={ORDER_STATUS[o.status]} />
            </Link>
          )) : <Empty title="Aún no tienes pedidos" />}
        </div>
      </div>
    </>
  );
}
