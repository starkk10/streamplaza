import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { normalizePhone } from "@/lib/format";
import { audit } from "./audit";

export const SESSION_COOKIE = "sp_session";
export const SESSION_DAYS = 7;

const secret = () => new TextEncoder().encode(requireEnv("AUTH_SECRET"));

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId)
    .setIssuedAt().setExpirationTime(`${SESSION_DAYS}d`).sign(secret());
}

export async function verifySessionToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Escribe tu nombre.").max(80),
  email: z.string().trim().toLowerCase().email("Escribe un correo válido."),
  phone: z.string().trim().optional().transform(v => (v ? normalizePhone(v) : undefined))
    .refine(v => !v || (v.length >= 8 && v.length <= 15), "El WhatsApp debe incluir el código de país, por ejemplo +51 912 345 678."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(100),
});

export async function registerCustomer(input: z.input<typeof registerSchema>) {
  const data = registerSchema.parse(input);
  const existing = await db.user.findUnique({ where: { email: data.email } });
  if (existing) throw new AppError("Ya existe una cuenta con ese correo. Inicia sesión.");
  if (data.phone) {
    const byPhone = await db.user.findUnique({ where: { phone: data.phone } });
    // Un cliente que compró por WhatsApp sin cuenta puede reclamar su número creando la cuenta
    if (byPhone && byPhone.passwordHash) throw new AppError("Ese número de WhatsApp ya está registrado en otra cuenta.");
    if (byPhone) {
      const user = await db.user.update({
        where: { id: byPhone.id },
        data: { email: data.email, name: data.name, passwordHash: await hashPassword(data.password) },
      });
      await audit(user.id, "cliente.registro", "User", user.id, { via: "reclamo_whatsapp" });
      return user;
    }
  }
  const user = await db.user.create({
    data: { name: data.name, email: data.email, phone: data.phone, passwordHash: await hashPassword(data.password), role: "CLIENTE" },
  });
  await audit(user.id, "cliente.registro", "User", user.id);
  return user;
}

// Freno simple contra fuerza bruta. En varias instancias conviene moverlo a Redis.
const attempts = new Map<string, { n: number; until: number }>();

export async function authenticate(emailRaw: string, password: string) {
  const email = String(emailRaw ?? "").trim().toLowerCase();
  const now = Date.now();
  const a = attempts.get(email);
  if (a && a.until > now && a.n >= 5) throw new AppError("Demasiados intentos. Espera 10 minutos e inténtalo otra vez.");
  const user = email ? await db.user.findUnique({ where: { email } }) : null;
  const ok = !!user?.passwordHash && (await bcrypt.compare(password ?? "", user.passwordHash));
  if (!ok || !user) {
    const cur = a && a.until > now ? a : { n: 0, until: now + 10 * 60_000 };
    attempts.set(email, { n: cur.n + 1, until: cur.until });
    throw new AppError("Correo o contraseña incorrectos.");
  }
  if (!user.active) throw new AppError("Tu cuenta está desactivada. Contacta con soporte.");
  attempts.delete(email);
  return user;
}
