import { db } from "@/lib/db";
import { decrypt, encrypt, fingerprint } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { audit } from "./audit";

/** Lee un CSV sencillo con comillas opcionales. Devuelve filas como objetos según la cabecera. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  const sep = (src.split("\n")[0].match(/;/g)?.length ?? 0) > (src.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(c => c.trim()));
  if (!head) return [];
  const keys = head.map(h => h.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

type NewCode = { code: string; productId: string; providerId?: string | null; expiresAt?: Date | null };

async function insertCodes(items: NewCode[]) {
  let added = 0;
  const duplicates: string[] = [];
  for (const it of items) {
    const code = it.code.trim();
    if (!code) continue;
    const codeHash = fingerprint(code);
    const exists = await db.license.findUnique({ where: { codeHash }, select: { id: true } });
    if (exists) { duplicates.push("…" + code.slice(-4)); continue; }
    try {
      await db.license.create({
        data: { productId: it.productId, providerId: it.providerId || null, expiresAt: it.expiresAt ?? null, codeEnc: encrypt(code), codeHash, last4: code.slice(-4) },
      });
      added++;
    } catch {
      duplicates.push("…" + code.slice(-4)); // carrera con otra importación: la restricción única lo frena
    }
  }
  return { added, duplicates };
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/) || s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) throw new AppError(`Fecha no válida: "${s}". Usa AAAA-MM-DD o DD/MM/AAAA.`);
  const [y, mo, d] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  return new Date(`${y}-${mo}-${d}T23:59:59Z`);
}

/** Alta manual: un código por línea. */
export async function addLicenses(actorId: string, productId: string, providerId: string | null, codesText: string, expires?: string) {
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) throw new AppError("Elige un producto.");
  const codes = [...new Set(codesText.split(/\r?\n/).map(c => c.trim()).filter(Boolean))];
  if (!codes.length) throw new AppError("Escribe al menos un código.");
  if (codes.length > 2000) throw new AppError("Máximo 2000 códigos por carga.");
  const r = await insertCodes(codes.map(code => ({ code, productId, providerId, expiresAt: parseDate(expires) })));
  await audit(actorId, "licencias.alta", "Product", productId, { agregados: r.added, repetidos: r.duplicates.length });
  return r;
}

/** Importa un CSV con columnas: codigo, producto (slug o nombre), proveedor (opcional), vence (opcional). */
export async function importLicensesCsv(actorId: string, csv: string) {
  const rows = parseCsv(csv);
  if (!rows.length) throw new AppError("El archivo no tiene filas. La primera fila debe ser la cabecera: codigo,producto,proveedor,vence");
  if (rows.length > 5000) throw new AppError("Máximo 5000 filas por archivo.");
  if (!("codigo" in rows[0]) || !("producto" in rows[0])) throw new AppError("Faltan columnas. La cabecera debe incluir codigo y producto.");
  const products = await db.product.findMany();
  const providers = new Map((await db.provider.findMany()).map(p => [p.name.toLowerCase(), p.id]));
  const items: NewCode[] = [];
  const errors: string[] = [];
  for (const [i, r] of rows.entries()) {
    const p = products.find(x => x.slug === r.producto.toLowerCase() || x.name.toLowerCase() === r.producto.toLowerCase());
    if (!p) { errors.push(`Fila ${i + 2}: producto "${r.producto}" no existe.`); continue; }
    let providerId: string | null = null;
    if (r.proveedor) {
      providerId = providers.get(r.proveedor.toLowerCase()) ?? null;
      if (!providerId) {
        const created = await db.provider.create({ data: { name: r.proveedor } });
        providers.set(r.proveedor.toLowerCase(), created.id);
        providerId = created.id;
      }
    }
    try { items.push({ code: r.codigo, productId: p.id, providerId, expiresAt: parseDate(r.vence) }); }
    catch (e) { errors.push(`Fila ${i + 2}: ${(e as Error).message}`); }
  }
  const res = await insertCodes(items);
  await audit(actorId, "licencias.importacion", "License", null, { agregados: res.added, repetidos: res.duplicates.length, errores: errors.length });
  return { ...res, errors };
}

/** Muestra un código en claro. Solo para usuarios con permiso; queda registrado en el historial. */
export async function revealLicense(actorId: string, licenseId: string) {
  const l = await db.license.findUnique({ where: { id: licenseId } });
  if (!l) throw new AppError("No encontramos el código.");
  await audit(actorId, "licencia.revelada", "License", licenseId);
  return decrypt(l.codeEnc);
}

export async function setLicenseExpired(actorId: string, licenseId: string) {
  const up = await db.license.updateMany({ where: { id: licenseId, status: { in: ["DISPONIBLE"] } }, data: { status: "VENCIDO" } });
  if (!up.count) throw new AppError("Solo se pueden marcar como vencidos los códigos disponibles.");
  await audit(actorId, "licencia.vencida", "License", licenseId);
}

export async function deleteLicense(actorId: string, licenseId: string) {
  const del = await db.license.deleteMany({ where: { id: licenseId, orderItemId: null, status: { in: ["DISPONIBLE", "VENCIDO"] } } });
  if (!del.count) throw new AppError("No se puede eliminar un código reservado o entregado.");
  await audit(actorId, "licencia.eliminada", "License", licenseId);
}

export async function expireLicenses(now = new Date()) {
  const r = await db.license.updateMany({ where: { status: "DISPONIBLE", expiresAt: { lt: now } }, data: { status: "VENCIDO" } });
  return r.count;
}
