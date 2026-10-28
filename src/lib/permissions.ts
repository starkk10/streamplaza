import type { Role } from "@prisma/client";

export const PERMISSIONS = [
  "dashboard.view",
  "orders.manage",
  "payments.review",
  "payments.refund",
  "customers.view",
  "subscriptions.manage",
  "licenses.manage",
  "licenses.reveal",
  "products.manage",
  "coupons.manage",
  "providers.manage",
  "support.manage",
  "whatsapp.manage",
  "notifications.view",
  "audit.view",
  "settings.manage",
  "users.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const EMPLEADO: Permission[] = [
  "dashboard.view", "orders.manage", "payments.review", "customers.view", "subscriptions.manage",
  "licenses.manage", "support.manage", "whatsapp.manage", "notifications.view",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  EMPLEADO,
  CLIENTE: [],
};

export function can(role: Role | undefined | null, perm: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(perm);
}

export const ROLE_LABEL: Record<Role, string> = { ADMIN: "Administrador", EMPLEADO: "Empleado", CLIENTE: "Cliente" };
