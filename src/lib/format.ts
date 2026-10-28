export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-PE", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

/** Convierte "12.50" o "12,50" en céntimos. Devuelve null si no es un importe válido. */
export function parseMoney(input: string): number | null {
  const s = String(input ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function formatDate(d: Date | string | null | undefined, tz = "America/Lima"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric", timeZone: tz }).format(new Date(d));
}

export function formatDateTime(d: Date | string | null | undefined, tz = "America/Lima"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(d));
}

/** Fecha AAAA-MM-DD en la zona horaria de la tienda. */
export function dayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Días de calendario entre hoy y la fecha de fin, en la zona horaria de la tienda. Negativo = vencida. */
export function daysLeft(endAt: Date, tz: string, now = new Date()): number {
  const a = Date.parse(dayKey(now, tz) + "T00:00:00Z");
  const b = Date.parse(dayKey(endAt, tz) + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}

/** Deja solo dígitos; acepta +51 999 888 777 o 51999888777. */
export function normalizePhone(input: string): string {
  return String(input ?? "").replace(/\D/g, "");
}

export function orderCode(n: number): string {
  return "SP-" + String(n).padStart(5, "0");
}
