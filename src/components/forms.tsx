"use client";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/errors";

export type FormAction = (prev: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;

const PendingContext = createContext(false);

/**
 * Formulario conectado a una acción del servidor: muestra carga, éxito y error.
 * action={} se mantiene para que, antes de cargar el JavaScript, el navegador envíe por POST
 * a la acción del servidor (nunca por GET con los datos en la URL). Ya cargada la página,
 * onSubmit toma el control con startTransition para que React no vacíe los campos
 * cuando la acción devuelve un error.
 */
export function ActionForm({ action, children, className = "form", resetOnSuccess = false, id }: {
  action: FormAction; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} id={id} aria-busy={pending} onSubmit={e => {
      e.preventDefault();
      if (pending) return;
      const fd = new FormData(e.currentTarget);
      startTransition(() => formAction(fd));
    }}>
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {state && !pending && (state.ok ? (state.message ? <div className="alert ok full" role="status">{state.message}</div> : null)
        : <div className="alert err full" role="alert">{state.error}</div>)}
    </form>
  );
}

export function SubmitButton({ children, className = "btn", pendingText = "Procesando…", confirmText }: {
  children: React.ReactNode; className?: string; pendingText?: string; confirmText?: string;
}) {
  const pending = useContext(PendingContext);
  const [armed, setArmed] = useState(false);
  if (confirmText && !armed) {
    return <button type="button" className={className} onClick={() => setArmed(true)}>{children}</button>;
  }
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : confirmText && armed ? confirmText : children}
    </button>
  );
}

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn ghost sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* el texto sigue visible para copiarlo a mano */ }
    }}>{done ? "Copiado" : label}</button>
  );
}
