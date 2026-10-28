"use server";
// Acciones del panel. Cada una valida permisos en el servidor antes de hacer nada.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { DeliveryType, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { AppError, toResult, type ActionResult } from "@/lib/errors";
import { normalizePhone, parseMoney } from "@/lib/format";
import { approvePayment, refundPayment, rejectPayment } from "@/server/payments";
import { cancelOrder } from "@/server/orders";
import { deliverItemManually, retryDelivery } from "@/server/delivery";
import { addLicenses, deleteLicense, importLicensesCsv, revealLicense, setLicenseExpired } from "@/server/licenses";
import { cancelSubscription } from "@/server/subscriptions";
import { kickQueue, notifyUser, processNotificationQueue } from "@/server/notifications";
import { setHandoff, staffReply } from "@/server/bot";
import { setSettings, SETTING_DEFAULTS, type SettingKey } from "@/server/settings";
import { saveUploadFromFile } from "@/server/storage";
import { hashPassword } from "@/server/auth";
import { audit } from "@/server/audit";
import { env } from "@/lib/env";

type R = ActionResult<unknown>;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function money(fd: FormData, k: string, label: string) {
  const v = parseMoney(str(fd, k));
  if (v === null) throw new AppError(`${label}: escribe un importe válido, por ejemplo 15.00`);
  return v;
}

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

// ── Pagos ──────────────────────────────────────────────────────
export async function approvePaymentAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("payments.review");
    const r = await approvePayment(str(fd, "paymentId"), u.id, money(fd, "received", "Monto recibido"));
    revalidatePath("/admin", "layout");
    if (!r.complete) throw new AppError(r.outOfStock.length
      ? `Pago aprobado, pero no hay stock de: ${r.outOfStock.join(", ")}. Carga códigos y reintenta la entrega desde el pedido.`
      : `Pago aprobado. Falta la entrega manual de: ${r.manualPending.join(", ")}.`);
  }, "Pago aprobado y pedido entregado.");
}

export async function rejectPaymentAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("payments.review");
    await rejectPayment(str(fd, "paymentId"), u.id, str(fd, "reason"));
    revalidatePath("/admin", "layout");
  }, "Pago rechazado. Avisamos al cliente.");
}

export async function refundPaymentAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("payments.refund");
    await refundPayment(str(fd, "paymentId"), u.id, str(fd, "reason"));
    revalidatePath("/admin", "layout");
  }, "Reembolso registrado. El pedido quedó cancelado.");
}

// ── Pedidos ────────────────────────────────────────────────────
export async function cancelOrderAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("orders.manage");
    const reason = str(fd, "reason");
    if (reason.length < 3) throw new AppError("Escribe el motivo de la cancelación.");
    await cancelOrder(str(fd, "orderId"), u.id, reason);
    revalidatePath("/admin", "layout");
  }, "Pedido cancelado y stock liberado.");
}

export async function retryDeliveryAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("orders.manage");
    const r = await retryDelivery(str(fd, "orderId"), u.id);
    revalidatePath("/admin", "layout");
    if (!r.complete) throw new AppError(r.outOfStock.length ? `Sigue sin stock de: ${r.outOfStock.join(", ")}.` : `Falta la entrega manual de: ${r.manualPending.join(", ")}.`);
  }, "Pedido entregado.");
}

export async function manualDeliveryAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("orders.manage");
    await deliverItemManually(str(fd, "itemId"), str(fd, "note"), u.id);
    revalidatePath("/admin", "layout");
  }, "Entrega registrada.");
}

// ── Productos, planes y categorías ─────────────────────────────
const productSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre.").max(80),
  slug: z.string().trim().max(60),
  shortDescription: z.string().trim().max(200),
  description: z.string().trim().max(5000),
  instructions: z.string().trim().max(3000),
  imageUrl: z.string().trim().max(500).refine(v => !v || /^https?:\/\//.test(v) || v.startsWith("/api/files/public/"), "La imagen debe ser un enlace https:// o un archivo subido."),
  categoryId: z.string().trim(),
  deliveryType: z.enum(["LICENCIA", "MANUAL"]),
  lowStockAlert: z.coerce.number().int().min(0).max(1000),
});

export async function saveProductAction(_: R | null, fd: FormData): Promise<R> {
  const r = await toResult(async () => {
    const u = await requirePermission("products.manage");
    const p = productSchema.safeParse(Object.fromEntries(["name", "slug", "shortDescription", "description", "instructions", "imageUrl", "categoryId", "deliveryType", "lowStockAlert"].map(k => [k, str(fd, k)])));
    if (!p.success) throw new AppError(p.error.issues[0].message);
    const id = str(fd, "id");
    const image = fd.get("image");
    const uploaded = await saveUploadFromFile("public", image instanceof File ? image : null);
    const data = {
      ...p.data, slug: slugify(p.data.slug || p.data.name), categoryId: p.data.categoryId || null,
      imageUrl: uploaded ? `/api/files/public/${uploaded}` : p.data.imageUrl || null,
      deliveryType: p.data.deliveryType as DeliveryType, active: fd.get("active") === "on",
    };
    if (!data.slug) throw new AppError("El enlace del producto no es válido.");
    const clash = await db.product.findUnique({ where: { slug: data.slug } });
    if (clash && clash.id !== id) throw new AppError("Ya existe otro producto con ese enlace. Cambia el nombre o el enlace.");
    const saved = id ? await db.product.update({ where: { id }, data }) : await db.product.create({ data });
    await audit(u.id, id ? "producto.editado" : "producto.creado", "Product", saved.id);
    revalidatePath("/admin/productos");
    return saved.id;
  }, "Producto guardado.");
  if (r.ok && !str(fd, "id")) redirect(`/admin/productos/${r.data}`);
  return r;
}

export async function savePlanAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("products.manage");
    const name = str(fd, "name");
    const durationDays = Number(str(fd, "durationDays"));
    if (name.length < 2) throw new AppError("Escribe el nombre del plan, por ejemplo 1 mes.");
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) throw new AppError("La duración debe ser de 1 a 3650 días.");
    const priceCents = money(fd, "price", "Precio");
    if (priceCents < 1) throw new AppError("El precio debe ser mayor que cero.");
    const id = str(fd, "planId");
    const data = { name: name.slice(0, 60), durationDays, priceCents, active: fd.get("active") === "on", sortOrder: Number(str(fd, "sortOrder")) || 0 };
    if (id) await db.plan.update({ where: { id }, data });
    else await db.plan.create({ data: { ...data, productId: str(fd, "productId") } });
    await audit(u.id, id ? "plan.editado" : "plan.creado", "Plan", id || null, { precio: priceCents });
    revalidatePath(`/admin/productos/${str(fd, "productId")}`);
  }, "Plan guardado.");
}

export async function saveCategoryAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("products.manage");
    const name = str(fd, "name");
    if (name.length < 2) throw new AppError("Escribe el nombre de la categoría.");
    const slug = slugify(name);
    if (await db.category.findUnique({ where: { slug } })) throw new AppError("Esa categoría ya existe.");
    await db.category.create({ data: { name, slug, sortOrder: Number(str(fd, "sortOrder")) || 0 } });
    await audit(u.id, "categoria.creada", "Category", slug);
    revalidatePath("/admin/productos");
  }, "Categoría creada.");
}

export async function deleteCategoryAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("products.manage");
    const id = str(fd, "id");
    if (await db.product.count({ where: { categoryId: id } })) throw new AppError("La categoría tiene productos. Muévelos antes de eliminarla.");
    await db.category.delete({ where: { id } });
    await audit(u.id, "categoria.eliminada", "Category", id);
    revalidatePath("/admin/productos");
  }, "Categoría eliminada.");
}

// ── Licencias y proveedores ────────────────────────────────────
export async function addLicensesAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("licenses.manage");
    const r = await addLicenses(u.id, str(fd, "productId"), str(fd, "providerId") || null, String(fd.get("codes") ?? ""), str(fd, "expires") || undefined);
    revalidatePath("/admin/licencias");
    return r;
  }).then(r => r.ok ? { ok: true as const, message: `Se agregaron ${(r.data as { added: number }).added} códigos.${(r.data as { duplicates: string[] }).duplicates.length ? ` ${(r.data as { duplicates: string[] }).duplicates.length} ya existían y se omitieron.` : ""}` } : r);
}

export async function importLicensesAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("licenses.manage");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Elige el archivo CSV.");
    if (file.size > 2 * 1024 * 1024) throw new AppError("El CSV pesa más de 2 MB. Divídelo en partes.");
    const r = await importLicensesCsv(u.id, await file.text());
    revalidatePath("/admin/licencias");
    const msg = `Importados: ${r.added}. Repetidos omitidos: ${r.duplicates.length}.${r.errors.length ? ` Errores: ${r.errors.slice(0, 5).join(" ")}${r.errors.length > 5 ? " …" : ""}` : ""}`;
    if (!r.added && r.errors.length) throw new AppError(msg);
    return msg;
  }).then(r => r.ok ? { ok: true as const, message: String(r.data) } : r);
}

export async function revealLicenseAction(licenseId: string): Promise<ActionResult<string>> {
  return toResult(async () => {
    const u = await requirePermission("licenses.reveal");
    return revealLicense(u.id, licenseId);
  });
}

export async function licenseStatusAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("licenses.manage");
    if (str(fd, "op") === "delete") await deleteLicense(u.id, str(fd, "id"));
    else await setLicenseExpired(u.id, str(fd, "id"));
    revalidatePath("/admin/licencias");
  }, "Código actualizado.");
}

export async function saveProviderAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("providers.manage");
    const name = str(fd, "name");
    if (name.length < 2) throw new AppError("Escribe el nombre del proveedor.");
    if (await db.provider.findUnique({ where: { name } })) throw new AppError("Ya existe un proveedor con ese nombre.");
    const p = await db.provider.create({ data: { name, contact: str(fd, "contact").slice(0, 120), note: str(fd, "note").slice(0, 500) } });
    await audit(u.id, "proveedor.creado", "Provider", p.id);
    revalidatePath("/admin/proveedores");
  }, "Proveedor guardado.");
}

export async function deleteProviderAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("providers.manage");
    const id = str(fd, "id");
    if (await db.license.count({ where: { providerId: id } })) throw new AppError("El proveedor tiene códigos registrados y no se puede eliminar.");
    await db.provider.delete({ where: { id } });
    await audit(u.id, "proveedor.eliminado", "Provider", id);
    revalidatePath("/admin/proveedores");
  }, "Proveedor eliminado.");
}

// ── Suscripciones y clientes ───────────────────────────────────
export async function cancelSubscriptionAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("subscriptions.manage");
    await cancelSubscription(str(fd, "id"), u.id, str(fd, "reason"));
    revalidatePath("/admin/suscripciones");
  }, "Suscripción cancelada.");
}

export async function toggleCustomerAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("users.manage");
    const id = str(fd, "id");
    if (id === u.id) throw new AppError("No puedes desactivar tu propia cuenta.");
    const target = await db.user.findUniqueOrThrow({ where: { id } });
    await db.user.update({ where: { id }, data: { active: !target.active } });
    await audit(u.id, target.active ? "usuario.desactivado" : "usuario.activado", "User", id);
    revalidatePath(`/admin/clientes/${id}`);
  }, "Cuenta actualizada.");
}

// ── Cupones ────────────────────────────────────────────────────
export async function saveCouponAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("coupons.manage");
    const code = str(fd, "code").toUpperCase().replace(/\s/g, "");
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new AppError("El código debe tener de 3 a 30 letras, números, - o _.");
    const type = str(fd, "type") === "MONTO" ? "MONTO" : "PORCENTAJE";
    const value = type === "MONTO" ? money(fd, "value", "Descuento") : Number(str(fd, "value"));
    if (type === "PORCENTAJE" && (!Number.isInteger(value) || value < 1 || value > 100)) throw new AppError("El porcentaje debe ser un número entero de 1 a 100.");
    if (value <= 0) throw new AppError("El descuento debe ser mayor que cero.");
    const maxUses = str(fd, "maxUses") ? Number(str(fd, "maxUses")) : null;
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) throw new AppError("El límite de usos debe ser un número entero positivo.");
    const minTotal = str(fd, "minTotal") ? money(fd, "minTotal", "Compra mínima") : 0;
    const startsAt = str(fd, "startsAt") ? new Date(str(fd, "startsAt") + "T00:00:00") : null;
    const endsAt = str(fd, "endsAt") ? new Date(str(fd, "endsAt") + "T23:59:59") : null;
    if (startsAt && endsAt && endsAt < startsAt) throw new AppError("La fecha de fin es anterior a la de inicio.");
    if (await db.coupon.findUnique({ where: { code } })) throw new AppError("Ya existe un cupón con ese código.");
    await db.coupon.create({ data: { code, type, value, maxUses, minTotalCents: minTotal, startsAt, endsAt, description: str(fd, "description").slice(0, 200) } });
    await audit(u.id, "cupon.creado", "Coupon", code);
    revalidatePath("/admin/cupones");
  }, "Cupón creado.");
}

export async function toggleCouponAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("coupons.manage");
    const c = await db.coupon.findUniqueOrThrow({ where: { id: str(fd, "id") } });
    await db.coupon.update({ where: { id: c.id }, data: { active: !c.active } });
    await audit(u.id, c.active ? "cupon.desactivado" : "cupon.activado", "Coupon", c.code);
    revalidatePath("/admin/cupones");
  }, "Cupón actualizado.");
}

// ── Notificaciones ─────────────────────────────────────────────
export async function retryNotificationAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    await requirePermission("notifications.view");
    const id = str(fd, "id");
    await db.notification.updateMany({ where: { id: id || undefined, status: { in: ["FALLIDA", "OMITIDA"] } }, data: { status: "PENDIENTE", attempts: 0, sendAfter: new Date(), error: null } });
    const r = await processNotificationQueue();
    revalidatePath("/admin/notificaciones");
    return r;
  }).then(r => r.ok ? { ok: true as const, message: `Enviados: ${(r.data as { sent: number }).sent}. Omitidos: ${(r.data as { skipped: number }).skipped}. Fallidos: ${(r.data as { failed: number }).failed}.` } : r);
}

// ── WhatsApp y soporte ─────────────────────────────────────────
export async function waReplyAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("whatsapp.manage");
    await staffReply(str(fd, "conversationId"), u.id, str(fd, "message"));
    revalidatePath("/admin/whatsapp");
  }, "Mensaje enviado.");
}

export async function waHandoffAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("whatsapp.manage");
    await setHandoff(str(fd, "conversationId"), u.id, str(fd, "on") === "1");
    revalidatePath("/admin/whatsapp");
  }, "Conversación actualizada.");
}

export async function ticketReplyAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("support.manage");
    const t = await db.supportTicket.findUniqueOrThrow({ where: { id: str(fd, "ticketId") }, include: { customer: true } });
    const message = str(fd, "message");
    const close = fd.get("close") === "on";
    if (!message && !close) throw new AppError("Escribe la respuesta.");
    await db.$transaction([
      ...(message ? [db.ticketReply.create({ data: { ticketId: t.id, authorId: u.id, message: message.slice(0, 4000) } })] : []),
      db.supportTicket.update({ where: { id: t.id }, data: { status: close ? "CERRADO" : "RESPONDIDO" } }),
    ]);
    if (message) {
      await notifyUser(t.customer, "ticket.reply", { subject: t.subject, link: `${env.appUrl}/cuenta/soporte/${t.id}` }, `ticket.reply:${t.id}:${Date.now()}`);
      kickQueue();
    }
    await audit(u.id, close ? "soporte.cerrado" : "soporte.respondido", "SupportTicket", t.id);
    revalidatePath(`/admin/soporte/${t.id}`);
  }, "Respuesta guardada.");
}

// ── Usuarios del equipo ────────────────────────────────────────
export async function createStaffAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("users.manage");
    const email = str(fd, "email").toLowerCase();
    const role = str(fd, "role") as Role;
    const password = String(fd.get("password") ?? "");
    if (!z.string().email().safeParse(email).success) throw new AppError("Escribe un correo válido.");
    if (!["ADMIN", "EMPLEADO"].includes(role)) throw new AppError("Elige un rol.");
    if (password.length < 10) throw new AppError("La contraseña debe tener al menos 10 caracteres.");
    if (await db.user.findUnique({ where: { email } })) throw new AppError("Ya existe un usuario con ese correo. Cambia su rol desde la lista.");
    const phone = str(fd, "phone") ? normalizePhone(str(fd, "phone")) : null;
    const created = await db.user.create({ data: { email, name: str(fd, "name") || email, role, phone, passwordHash: await hashPassword(password) } });
    await audit(u.id, "usuario.creado", "User", created.id, { rol: role });
    revalidatePath("/admin/usuarios");
  }, "Usuario creado.");
}

export async function setRoleAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("users.manage");
    const id = str(fd, "id");
    const role = str(fd, "role") as Role;
    if (!["ADMIN", "EMPLEADO", "CLIENTE"].includes(role)) throw new AppError("Rol no válido.");
    if (id === u.id && role !== "ADMIN") throw new AppError("No puedes quitarte el rol de administrador.");
    await db.user.update({ where: { id }, data: { role } });
    await audit(u.id, "usuario.rol", "User", id, { rol: role });
    revalidatePath("/admin/usuarios");
  }, "Rol actualizado.");
}

// ── Configuración ──────────────────────────────────────────────
export async function saveSettingsAction(_: R | null, fd: FormData): Promise<R> {
  return toResult(async () => {
    const u = await requirePermission("settings.manage");
    const values: Partial<Record<SettingKey, string>> = {};
    for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
      if (key === "payment.qrFile") continue;
      if (key.startsWith("channels.") || key === "bot.enabled") values[key] = fd.get(key) === "on" ? "1" : "0";
      else if (fd.has(key)) values[key] = str(fd, key).slice(0, 2000);
    }
    if (values["store.currency"] && !/^[A-Z]{3}$/.test(values["store.currency"])) throw new AppError("La moneda debe ser un código de 3 letras, por ejemplo PEN o USD.");
    try { new Intl.DateTimeFormat("es", { timeZone: values["store.timezone"] }); } catch { throw new AppError("Zona horaria no válida. Ejemplo: America/Lima"); }
    if (values["reminders.days"] && !/^\s*\d{1,2}(\s*,\s*\d{1,2})*\s*$/.test(values["reminders.days"])) throw new AppError("Escribe los días de aviso separados por comas, por ejemplo 7,3,1,0");
    const qr = fd.get("qr");
    const saved = await saveUploadFromFile("public", qr instanceof File ? qr : null);
    if (saved) values["payment.qrFile"] = saved;
    if (values["store.currency"]) {
      const pending = await db.order.count({ where: { status: "PENDIENTE" } });
      const current = (await db.setting.findUnique({ where: { key: "store.currency" } }))?.value ?? SETTING_DEFAULTS["store.currency"];
      if (pending && values["store.currency"] !== current) throw new AppError(`Hay ${pending} pedidos pendientes en ${current}. Resuélvelos antes de cambiar la moneda.`);
    }
    await setSettings(values);
    await audit(u.id, "configuracion.guardada", "Setting", null, { claves: Object.keys(values) });
    revalidatePath("/", "layout");
  }, "Configuración guardada.");
}
