import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { readUpload } from "@/server/storage";

export const runtime = "nodejs";

// public: imágenes de productos y el QR de pago (cualquiera las ve).
// receipts: comprobantes de pago, solo el dueño del pedido o empleados con permiso.
export async function GET(req: Request, { params }: { params: Promise<{ kind: string; name: string }> }) {
  const { kind, name } = await params;
  if (kind !== "public" && kind !== "receipts") return new Response("Not found", { status: 404 });

  if (kind === "receipts") {
    const user = await getCurrentUser();
    const token = new URL(req.url).searchParams.get("t");
    const payment = await db.payment.findFirst({ where: { receiptPath: name }, include: { order: true } });
    const allowed = !!payment && (
      can(user?.role, "payments.review") ||
      (user && payment.order.customerId === user.id) ||
      (token && token === payment.order.accessToken)
    );
    if (!allowed) return new Response("Not found", { status: 404 });
  }

  const file = await readUpload(kind, name);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mime,
      "Cache-Control": kind === "public" ? "public, max-age=86400" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
