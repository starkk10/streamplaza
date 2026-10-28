import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { registerAction } from "../actions";
import { param, type SP } from "@/components/table";

export const metadata = { title: "Crear cuenta" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<SP> }) {
  const next = param(await searchParams, "next");
  return (
    <div className="card" style={{ maxWidth: 460, margin: "24px auto", width: "100%" }}>
      <h1>Crear cuenta</h1>
      <p className="muted small">Con tu cuenta ves tus pedidos, accesos, vencimientos y comprobantes.</p>
      <ActionForm action={registerAction}>
        <input type="hidden" name="next" value={next} />
        <label className="f">Nombre<input className="in" name="name" required minLength={2} maxLength={80} autoComplete="name" /></label>
        <label className="f">Correo<input className="in" name="email" type="email" required autoComplete="email" /></label>
        <label className="f">WhatsApp (opcional)<input className="in" name="phone" type="tel" placeholder="+51 912 345 678" autoComplete="tel" />
          <span className="hint">Si ya compraste por WhatsApp, usa el mismo número para ver esos pedidos.</span></label>
        <label className="f">Contraseña<input className="in" name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
        <SubmitButton pendingText="Creando cuenta…">Crear cuenta</SubmitButton>
      </ActionForm>
      <p className="small muted">¿Ya tienes cuenta? <Link className="link" href="/ingresar">Ingresa</Link></p>
    </div>
  );
}
