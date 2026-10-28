import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { OrderPayment } from "@/components/order-payment";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tu pedido", robots: { index: false } };

// Enlace seguro que envía el bot de WhatsApp: permite pagar sin crear cuenta.
export default async function OrderByTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[\w-]{20,64}$/.test(token)) notFound();
  const order = await db.order.findUnique({ where: { accessToken: token }, include: { items: true, payments: { orderBy: { createdAt: "desc" } } } });
  if (!order) notFound();
  return (
    <>
      <OrderPayment order={order} token={token} />
      <p className="hint">¿Quieres ver todos tus pedidos y vencimientos? <a className="link" href="/registro">Crea una cuenta</a> con el mismo número de WhatsApp.</p>
    </>
  );
}
