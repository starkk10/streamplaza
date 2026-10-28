import Link from "next/link";
import type { Prisma, SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { daysLeft, formatDate } from "@/lib/format";
import { DaysPill, Pill, SUB_STATUS } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Empty, Filters, Pager, pageOf, param, SortTh, sortOf, type SP } from "@/components/table";
import { cancelSubscriptionAction } from "../actions";

export const metadata = { title: "Suscripciones" };
const BASE = "/admin/suscripciones";

export default async function Subscriptions({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireStaffPage("subscriptions.manage");
  const tz = (await getSettings())["store.timezone"];
  const status = param(sp, "estado") as SubscriptionStatus;
  const within = Number(param(sp, "vence")) || 0;
  const productId = param(sp, "producto");
  const q = param(sp, "q");
  const where: Prisma.SubscriptionWhereInput = {
    ...(status in SUB_STATUS ? { status } : {}),
    ...(within ? { status: "ACTIVA", endAt: { lte: new Date(Date.now() + within * 86400000) } } : {}),
    ...(productId ? { productId } : {}),
    ...(q ? { customer: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || q } }] } } : {}),
  };
  const sort = sortOf(sp, ["endAt", "startAt"] as const, ["endAt", "asc"]);
  const { page, skip, take } = pageOf(sp);
  const [products, total, subs] = await Promise.all([
    db.product.findMany({ orderBy: { name: "asc" } }),
    db.subscription.count({ where }),
    db.subscription.findMany({ where, include: { customer: true, product: true, plan: true, license: true }, orderBy: { [sort.field]: sort.dir }, skip, take }),
  ]);

  return (
    <>
      <h1>Suscripciones</h1>
      <Filters base={BASE} sp={sp} placeholder="Cliente, correo o teléfono" selects={[
        { name: "estado", label: "Estado", options: Object.entries(SUB_STATUS).map(([k, v]) => [k, v[0]]) },
        { name: "vence", label: "Vence en", options: [["1", "1 día"], ["3", "3 días"], ["7", "7 días"], ["15", "15 días"]] },
        { name: "producto", label: "Producto", options: products.map(p => [p.id, p.name]) },
      ]} />
      <div className="card">
        {subs.length ? (
          <>
            <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Producto</th><th>Estado</th>
              <SortTh base={BASE} sp={sp} field="startAt">Inicio</SortTh><SortTh base={BASE} sp={sp} field="endAt">Vence</SortTh><th>Cancelar</th></tr></thead><tbody>
              {subs.map(x => (
                <tr key={x.id}>
                  <td><Link className="link" href={`/admin/clientes/${x.customerId}`}>{x.customer.name}</Link><span className="sub">{x.customer.phone ? "+" + x.customer.phone : x.customer.email}</span></td>
                  <td>{x.product.name}<span className="sub">{x.plan.name}{x.license ? ` · código …${x.license.last4}` : ""}</span></td>
                  <td><span className="row"><Pill v={SUB_STATUS[x.status]} />{x.status === "ACTIVA" && <DaysPill days={daysLeft(x.endAt, tz)} />}</span></td>
                  <td>{formatDate(x.startAt, tz)}</td>
                  <td>{formatDate(x.endAt, tz)}</td>
                  <td>{x.status !== "CANCELADA" && (
                    <ActionForm action={cancelSubscriptionAction} className="row">
                      <input type="hidden" name="id" value={x.id} />
                      <input className="in" name="reason" placeholder="Motivo" style={{ width: 140 }} aria-label="Motivo de cancelación" />
                      <SubmitButton className="btn danger sm" confirmText="Confirmar">Cancelar</SubmitButton>
                    </ActionForm>
                  )}</td>
                </tr>
              ))}
            </tbody></table></div>
            <Pager base={BASE} sp={sp} total={total} page={page} />
          </>
        ) : <Empty title="No hay suscripciones con ese filtro" />}
      </div>
    </>
  );
}
