import type { LicenseStatus, NotificationStatus, OrderStatus, PaymentStatus, SubscriptionStatus, TicketStatus } from "@prisma/client";

type Tone = "ok" | "warn" | "crit" | "info" | "mute";

export const ORDER_STATUS: Record<OrderStatus, [string, Tone]> = {
  PENDIENTE: ["Pendiente", "warn"], PAGADO: ["Pagado", "info"], PROCESADO: ["Procesando", "info"], ENTREGADO: ["Entregado", "ok"], CANCELADO: ["Cancelado", "mute"],
};
export const PAYMENT_STATUS: Record<PaymentStatus, [string, Tone]> = {
  EN_REVISION: ["En revisión", "warn"], APROBADO: ["Aprobado", "ok"], RECHAZADO: ["Rechazado", "crit"], REEMBOLSADO: ["Reembolsado", "mute"],
};
export const LICENSE_STATUS: Record<LicenseStatus, [string, Tone]> = {
  DISPONIBLE: ["Disponible", "ok"], RESERVADO: ["Reservado", "warn"], ENTREGADO: ["Entregado", "info"], VENCIDO: ["Vencido", "mute"],
};
export const SUB_STATUS: Record<SubscriptionStatus, [string, Tone]> = {
  ACTIVA: ["Activa", "ok"], VENCIDA: ["Vencida", "crit"], CANCELADA: ["Cancelada", "mute"],
};
export const NOTIF_STATUS: Record<NotificationStatus, [string, Tone]> = {
  PENDIENTE: ["Pendiente", "warn"], ENVIADA: ["Enviada", "ok"], FALLIDA: ["Fallida", "crit"], OMITIDA: ["Omitida", "mute"],
};
export const TICKET_STATUS: Record<TicketStatus, [string, Tone]> = {
  ABIERTO: ["Abierto", "warn"], RESPONDIDO: ["Respondido", "info"], CERRADO: ["Cerrado", "mute"],
};

export function Pill({ v }: { v: [string, Tone] }) {
  return <span className={`pill ${v[1]}`}>{v[0]}</span>;
}

export function DaysPill({ days }: { days: number }) {
  if (days < 0) return <span className="pill crit">Venció hace {-days} d</span>;
  if (days === 0) return <span className="pill crit">Vence hoy</span>;
  if (days <= 3) return <span className="pill warn">Vence en {days} d</span>;
  return <span className="pill ok">{days} días</span>;
}
