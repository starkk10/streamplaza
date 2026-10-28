import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";

/** Registra una operación relevante en el historial. Nunca guarda códigos ni contraseñas. */
export async function audit(
  actorId: string | null | undefined,
  action: string,
  entity: string,
  entityId?: string | null,
  detail?: Prisma.InputJsonValue,
  tx: Tx = db,
) {
  try {
    await tx.auditLog.create({ data: { actorId: actorId ?? null, action, entity, entityId: entityId ?? null, detail } });
  } catch (e) {
    console.error("[audit] no se pudo registrar", action, e);
  }
}
