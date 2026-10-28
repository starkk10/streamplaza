import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { ROLE_LABEL, ROLE_PERMISSIONS } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { getSettings } from "@/server/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { createStaffAction, setRoleAction } from "../actions";

export const metadata = { title: "Equipo y roles" };

export default async function Team() {
  const me = await requireStaffPage("users.manage");
  const tz = (await getSettings())["store.timezone"];
  const staff = await db.user.findMany({ where: { role: { in: ["ADMIN", "EMPLEADO"] } }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <h1>Equipo y roles</h1>
      <div className="grid-main">
        <div className="card">
          <div className="table-wrap"><table><thead><tr><th>Persona</th><th>Rol</th><th>Alta</th></tr></thead><tbody>
            {staff.map(u => (
              <tr key={u.id}>
                <td>{u.name}<span className="sub">{u.email}{!u.active ? " · desactivado" : ""}</span></td>
                <td>
                  {u.id === me.id ? ROLE_LABEL[u.role] + " (tú)" : (
                    <ActionForm action={setRoleAction} className="row">
                      <input type="hidden" name="id" value={u.id} />
                      <select className="in" name="role" defaultValue={u.role} style={{ width: "auto" }} aria-label={`Rol de ${u.name}`}>
                        <option value="ADMIN">Administrador</option><option value="EMPLEADO">Empleado</option><option value="CLIENTE">Quitar acceso al panel</option>
                      </select>
                      <SubmitButton className="btn ghost sm">Guardar</SubmitButton>
                    </ActionForm>
                  )}
                </td>
                <td>{formatDate(u.createdAt, tz)}</td>
              </tr>
            ))}
          </tbody></table></div>
          <h2>Qué puede hacer cada rol</h2>
          <p className="small"><b>Administrador:</b> todo, incluido ver códigos completos, reembolsos, productos, cupones, configuración, historial y equipo.</p>
          <p className="small"><b>Empleado:</b> {ROLE_PERMISSIONS.EMPLEADO.join(", ")}.</p>
        </div>
        <div className="card">
          <h2>Agregar persona</h2>
          <ActionForm action={createStaffAction} resetOnSuccess>
            <label className="f">Nombre<input className="in" name="name" required /></label>
            <label className="f">Correo<input className="in" name="email" type="email" required /></label>
            <label className="f">WhatsApp (para alertas)<input className="in" name="phone" type="tel" placeholder="+51 912 345 678" /></label>
            <label className="f">Rol<select className="in" name="role" defaultValue="EMPLEADO"><option value="EMPLEADO">Empleado</option><option value="ADMIN">Administrador</option></select></label>
            <label className="f">Contraseña inicial<input className="in" name="password" type="password" required minLength={10} autoComplete="new-password" /><span className="hint">Mínimo 10 caracteres. Compártela por un canal privado.</span></label>
            <SubmitButton>Crear usuario</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
