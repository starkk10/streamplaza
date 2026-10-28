"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate, registerCustomer } from "@/server/auth";
import { createOrder, quoteCart, type CartInput } from "@/server/orders";
import { submitPayment } from "@/server/payments";
import { saveUploadFromFile } from "@/server/storage";
import { endSession, getCurrentUser, startSession } from "@/lib/session";
import { AppError, toResult, type ActionResult } from "@/lib/errors";
import { formatMoney, parseMoney } from "@/lib/format";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

function safeNext(next: FormDataEntryValue | null, fallback = "/cuenta") {
  const s = String(next ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
}

export async function loginAction(_: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<unknown>> {
  const r = await toResult(async () => {
    const user = await authenticate(String(fd.get("email") ?? ""), String(fd.get("password") ?? ""));
    await startSession(user.id);
    return user.role;
  });
  if (!r.ok) return r;
  const next = safeNext(fd.get("next"), r.data === "CLIENTE" ? "/cuenta" : "/admin");
  redirect(next);
}

export async function registerAction(_: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<unknown>> {
  const r = await toResult(async () => {
    const parsed = await registerCustomer({
      name: String(fd.get("name") ?? ""), email: String(fd.get("email") ?? ""),
      phone: String(fd.get("phone") ?? "") || undefined, password: String(fd.get("password") ?? ""),
    }).catch(e => { if (e instanceof z.ZodError) throw new AppError(e.issues[0].message); throw e; });
    await startSession(parsed.id);
  });
  if (!r.ok) return r;
  redirect(safeNext(fd.get("next")));
}

export async function logoutAction() {
  await endSession();
  redirect("/");
}

export type QuoteView = {
  lines: { planId: string; product: string; plan: string; durationDays: number; qty: number; unit: string; line: string; slug: string }[];
  subtotal: string; discount: string; total: string; discountCents: number; coupon: string | null;
};

/** Calcula el carrito en el servidor para mostrar precios reales. */
export async function quoteAction(items: CartInput, coupon: string | null): Promise<ActionResult<QuoteView>> {
  return toResult(async () => {
    const q = await quoteCart(items, coupon).catch(e => { if (e instanceof z.ZodError) throw new AppError(e.issues[0].message); throw e; });
    const m = (c: number) => formatMoney(c, q.currency);
    return {
      lines: q.lines.map(l => ({ planId: l.plan.id, product: l.plan.product.name, plan: l.plan.name, durationDays: l.plan.durationDays, qty: l.qty, unit: m(l.plan.priceCents), line: m(l.lineCents), slug: l.plan.product.slug })),
      subtotal: m(q.subtotal), discount: m(q.discount), total: m(q.total), discountCents: q.discount, coupon: q.coupon?.code ?? null,
    };
  });
}

export async function checkoutAction(items: CartInput, coupon: string | null, idempotencyKey: string): Promise<ActionResult<{ orderId: string }>> {
  return toResult(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AppError("Inicia sesión para terminar la compra.", "auth");
    const order = await createOrder({ customerId: user.id, items, couponCode: coupon, channel: "WEB", idempotencyKey: `web:${user.id}:${idempotencyKey.slice(0, 64)}` })
      .catch(e => { if (e instanceof z.ZodError) throw new AppError(e.issues[0].message); throw e; });
    return { orderId: order.id };
  });
}

/** Envío del comprobante desde la página del pedido (con sesión) o desde el enlace seguro del bot. */
export async function submitPaymentAction(_: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<unknown>> {
  return toResult(async () => {
    const orderId = String(fd.get("orderId") ?? "");
    const token = String(fd.get("token") ?? "");
    const user = await getCurrentUser();
    const amount = parseMoney(String(fd.get("amount") ?? ""));
    if (amount === null) throw new AppError("Escribe el monto pagado, por ejemplo 15.00");
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError("No encontramos ese pedido.");
    const auth = token ? { accessToken: token } : user ? { customerId: user.id } : null;
    if (!auth) throw new AppError("Inicia sesión para enviar el comprobante.");
    const file = fd.get("receipt");
    const receiptPath = await saveUploadFromFile("receipts", file instanceof File ? file : null, true);
    await submitPayment({ orderId, auth, reference: String(fd.get("reference") ?? ""), amountCents: amount, receiptPath });
    revalidatePath(token ? `/pedido/${token}` : `/cuenta/pedidos/${orderId}`);
  }, "Recibimos tu comprobante. Te avisaremos cuando lo revisemos.");
}
