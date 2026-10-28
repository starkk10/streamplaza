/** Error con un mensaje pensado para mostrarse al usuario tal cual. */
export class AppError extends Error {
  constructor(message: string, public code: string = "app_error") {
    super(message);
    this.name = "AppError";
  }
}

export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };

/** Ejecuta una acción y convierte los errores en un resultado que la interfaz puede mostrar. */
export async function toResult<T>(fn: () => Promise<T>, okMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, message: okMessage, data };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    // Los redirects de Next.js deben propagarse
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    console.error("[accion]", e);
    return { ok: false, error: "Ocurrió un error inesperado. Inténtalo otra vez o revisa los registros del servidor." };
  }
}
