import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { OrderPayment } from "@/components/order-payment";
import { ActionForm, SubmitButton } from "@/components/forms";
import { cancelMyOrderAction } from "../../actions";
import { param, type SP } from "@/components/table";

export default async function MyOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const isNew = param(await searchParams, "nuevo") === "1";
  const user = await requireUser(`/cuenta/pedidos/${id}`);
  const order = await db.order.findUnique({ where: { id }, include: { items: true, payments: { orderBy: { createdAt: "desc" } } } });
  if (!order || order.customerId !== user.id) notFound();
  const canCancel = order.status === "PENDIENTE" && !order.payments.some(p => p.status === "EN_REVISION");
  return (
    <>
      <div className="topbar">
        <Link className="link small" href="/cuenta/pedidos">← Mis pedidos</Link>
        <div className="row">
          {order.status !== "PENDIENTE" && order.status !== "CANCELADO" && <a className="btn ghost sm" href={`/api/comprobante/${order.id}`}>Descargar comprobante (PDF)</a>}
          <Link className="btn ghost sm" href={`/cuenta/soporte?pedido=${order.id}`}>Ayuda con este pedido</Link>
        </div>
      </div>
      {isNew && order.status === "PENDIENTE" && <div className="alert ok">Pedido creado. Reservamos tu producto: paga con el QR y envía el comprobante.</div>}
      <OrderPayment order={order} />
      {canCancel && (
        <ActionForm action={cancelMyOrderAction} className="row">
          <input type="hidden" name="orderId" value={order.id} />
          <SubmitButton className="btn danger sm" confirmText="Confirmar cancelación">Cancelar pedido</SubmitButton>
        </ActionForm>
      )}
    </>
  );
}
