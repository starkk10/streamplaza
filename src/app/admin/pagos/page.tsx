import Link from "next/link";
import type { PaymentStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatMoney, orderCode } from "@/lib/format";
import { PAYMENT_STATUS, Pill, ORDER_STATUS } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { PaymentReview } from "@/components/admin-payment";
import { Empty, Filters, Pager, pageOf, param, type SP } from "@/components/table";

export const metadata = { title: "Aprobación de pagos" };

export default async function Payments({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireStaffPage("payments.review");
  const tz = (await getSettings())["store.timezone"];
  const status = (param(sp, "estado") || "EN_REVISION") as PaymentStatus | "TODOS";
  const q = param(sp, "q");
  const { page, skip, take } = pageOf(sp);
  const where: Prisma.PaymentWhereInput = {
    ...(status !== "TODOS" && status in PAYMENT_STATUS ? { status } : {}),
    ...(q ? { OR: [{ reference: { contains: q.toUpperCase() } }, { order: { customer: { name: { contains: q, mode: "insensitive" } } } }, ...(Number(q.replace(/\D/g, "")) ? [{ order: { number: Number(q.replace(/\D/g, "")) } }] : [])] } : {}),
  };
  const [total, payments] = await Promise.all([
    db.payment.count({ where }),
    db.payment.findMany({ where, include: { order: { include: { customer: true, items: true } } }, orderBy: { createdAt: status === "EN_REVISION" ? "asc" : "desc" }, skip, take }),
  ]);

  return (
    <>
      <div className="topbar"><h1>Aprobación de pagos</h1></div>
      <Filters base="/admin/pagos" sp={sp} placeholder="Operación, cliente o n.º de pedido" selects={[{ name: "estado", label: "Estado", allLabel: "En revisión", options: [["APROBADO", "Aprobados"], ["RECHAZADO", "Rechazados"], ["REEMBOLSADO", "Reembolsados"], ["TODOS", "Todos"]] }]} />
      {payments.length ? payments.map(p => (
        <div key={p.id} className="card">
          <div className="card-head">
            <div>
              <h2><Link className="link" href={`/admin/pedidos/${p.orderId}`}>Pedido {orderCode(p.order.number)}</Link> · {formatMoney(p.order.totalCents, p.order.currency)}</h2>
              <p className="muted small">{p.order.customer.name}{p.order.customer.phone ? ` · +${p.order.customer.phone}` : ""} · {p.order.items.map(i => `${i.productName} (${i.planName})`).join(", ")}</p>
            </div>
            <div className="row"><Pill v={ORDER_STATUS[p.order.status]} /></div>
          </div>
          <PaymentReview p={p} order={p.order} tz={tz} canRefund={can(user.role, "payments.refund")} />
        </div>
      )) : <div className="card"><Empty title={status === "EN_REVISION" ? "No hay comprobantes por revisar" : "No hay pagos con ese filtro"}>{status === "EN_REVISION" && "Cuando un cliente envíe su comprobante aparecerá aquí."}</Empty></div>}
      <Pager base="/admin/pagos" sp={sp} total={total} page={page} />
    </>
  );
}
