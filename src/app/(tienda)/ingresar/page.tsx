import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { loginAction } from "../actions";
import { param, type SP } from "@/components/table";

export const metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<SP> }) {
  const next = param(await searchParams, "next");
  return (
    <div className="card" style={{ maxWidth: 420, margin: "24px auto", width: "100%" }}>
      <h1>Ingresar</h1>
      <ActionForm action={loginAction}>
        <input type="hidden" name="next" value={next} />
        <label className="f">Correo<input className="in" name="email" type="email" required autoComplete="email" /></label>
        <label className="f">Contraseña<input className="in" name="password" type="password" required autoComplete="current-password" /></label>
        <SubmitButton pendingText="Ingresando…">Ingresar</SubmitButton>
      </ActionForm>
      <p className="small muted">¿No tienes cuenta? <Link className="link" href={`/registro${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Crea una</Link></p>
    </div>
  );
}
