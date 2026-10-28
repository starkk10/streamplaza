import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { orderCode } from "@/lib/format";
import { buildReceiptPdf } from "@/server/receipt";
import { getSettings } from "@/server/settings";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true, payments: true, customer: true } });
  if (!order || (order.customerId !== user.id && !can(user.role, "orders.manage"))) return new Response("Not found", { status: 404 });
  const pdf = await buildReceiptPdf(order, await getSettings());
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="comprobante-${orderCode(order.number)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
