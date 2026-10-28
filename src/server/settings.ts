import { db } from "@/lib/db";

export const SETTING_DEFAULTS = {
  "store.name": "StreamPlaza",
  "store.currency": "PEN",
  "store.timezone": "America/Lima",
  "store.supportWhatsapp": "",
  "store.supportEmail": "",
  "payment.instructions": "Escanea el QR con Yape o Plin, paga el total exacto y registra el número de operación con la foto del comprobante.",
  "payment.qrFile": "",
  "payment.holder": "",
  "reminders.days": "7,3,1,0",
  "channels.email": "1",
  "channels.whatsapp": "1",
  "bot.enabled": "1",
  "bot.welcome": "¡Hola! Soy el asistente de ventas. Te ayudo a comprar y a revisar tus pedidos.",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = Record<SettingKey, string>;

export async function getSettings(): Promise<Settings> {
  const rows = await db.setting.findMany();
  const out = { ...SETTING_DEFAULTS } as Settings;
  for (const r of rows) if (r.key in out) out[r.key as SettingKey] = r.value;
  return out;
}

export async function setSettings(values: Partial<Settings>) {
  await db.$transaction(
    Object.entries(values).filter(([k]) => k in SETTING_DEFAULTS).map(([key, value]) =>
      db.setting.upsert({ where: { key }, create: { key, value: String(value ?? "") }, update: { value: String(value ?? "") } })),
  );
}

export function reminderDays(s: Settings): number[] {
  return [...new Set(s["reminders.days"].split(",").map(x => Number(x.trim())).filter(n => Number.isInteger(n) && n >= 0 && n <= 60))]
    .sort((a, b) => b - a);
}
