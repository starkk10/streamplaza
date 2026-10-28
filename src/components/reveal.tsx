"use client";
import { useState } from "react";
import { revealLicenseAction } from "@/app/admin/actions";

/** Muestra un código cifrado solo cuando el administrador lo pide; cada vista queda en el historial. */
export function RevealCode({ id, last4 }: { id: string; last4: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (code) return <span className="code-box">{code}</span>;
  return (
    <span className="row">
      <span className="mono">•••• {last4}</span>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await revealLicenseAction(id);
        setBusy(false);
        if (r.ok) setCode(r.data!); else setErr(r.error);
      }}>{busy ? "…" : "Ver"}</button>
      {err && <span className="small" style={{ color: "var(--crit)" }}>{err}</span>}
    </span>
  );
}
