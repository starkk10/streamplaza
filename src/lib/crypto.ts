import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requireEnv } from "./env";

function key(): Buffer {
  const hex = requireEnv("ENCRYPTION_KEY");
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY debe tener 64 caracteres hexadecimales (32 bytes).");
  return buf;
}

/** Cifra con AES-256-GCM. Formato: iv.tag.datos en base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map(p => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Huella para detectar códigos repetidos sin guardar el texto en claro. */
export function fingerprint(value: string): string {
  return createHmac("sha256", key()).update(value.trim()).digest("hex");
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function hmacSha256Hex(secret: string, body: string | Buffer): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}
