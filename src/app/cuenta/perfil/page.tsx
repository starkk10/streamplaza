import { requireUser } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/forms";
import { updateProfileAction } from "../actions";

export const metadata = { title: "Mi perfil" };

export default async function Profile() {
  const user = await requireUser("/cuenta/perfil");
  return (
    <>
      <h1>Mi perfil</h1>
      <div className="card" style={{ maxWidth: 560 }}>
        <ActionForm action={updateProfileAction}>
          <label className="f">Nombre<input className="in" name="name" defaultValue={user.name} required /></label>
          <label className="f">Correo<input className="in" value={user.email ?? ""} disabled readOnly /></label>
          <label className="f">WhatsApp<input className="in" name="phone" type="tel" defaultValue={user.phone ? "+" + user.phone : ""} placeholder="+51 912 345 678" /></label>
          <span className="hint">Avisos de pedidos, entregas y vencimientos:</span>
          <label className="check"><input type="checkbox" name="notifyEmail" defaultChecked={user.notifyEmail} /> Por correo</label>
          <label className="check"><input type="checkbox" name="notifyWhatsapp" defaultChecked={user.notifyWhatsapp} /> Por WhatsApp</label>
          <SubmitButton pendingText="Guardando…">Guardar</SubmitButton>
        </ActionForm>
      </div>
    </>
  );
}
