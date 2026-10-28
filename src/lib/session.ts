import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { can, type Permission } from "./permissions";
import { createSessionToken, SESSION_COOKIE, SESSION_DAYS, verifySessionToken } from "@/server/auth";
import { AppError } from "./errors";

/** Usuario de la sesión actual, leído de la base de datos en cada petición (el rol nunca se toma del token). */
export const getCurrentUser = cache(async () => {
  const store = await cookies();
  const id = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!id) return null;
  const user = await db.user.findUnique({ where: { id } });
  return user && user.active ? user : null;
});

export async function startSession(userId: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(userId), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86400,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Para páginas: redirige al inicio de sesión si no hay usuario. */
export async function requireUser(next = "/cuenta") {
  const user = await getCurrentUser();
  if (!user) redirect(`/ingresar?next=${encodeURIComponent(next)}`);
  return user;
}

/** Para páginas del panel: exige un permiso o muestra el inicio de sesión. */
export async function requireStaffPage(perm: Permission) {
  const user = await requireUser("/admin");
  if (!can(user.role, perm)) redirect(user.role === "CLIENTE" ? "/cuenta" : "/admin?sin-permiso=1");
  return user;
}

/** Para acciones del servidor: lanza un error si falta el permiso. */
export async function requirePermission(perm: Permission) {
  const user = await getCurrentUser();
  if (!user) throw new AppError("Tu sesión terminó. Vuelve a iniciar sesión.");
  if (!can(user.role, perm)) throw new AppError("No tienes permiso para hacer esta acción.");
  return user;
}

export async function requireCustomer() {
  const user = await getCurrentUser();
  if (!user) throw new AppError("Tu sesión terminó. Vuelve a iniciar sesión.");
  return user;
}
