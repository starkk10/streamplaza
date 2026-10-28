import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Empty } from "@/components/table";
import { deleteProviderAction, saveProviderAction } from "../actions";

export const metadata = { title: "Proveedores" };

export default async function Providers() {
  await requireStaffPage("providers.manage");
  const [providers, counts] = await Promise.all([
    db.provider.findMany({ orderBy: { name: "asc" } }),
    db.license.groupBy({ by: ["providerId", "status"], where: { providerId: { not: null } }, _count: true }),
  ]);
  const c = (id: string, st?: string) => counts.filter(x => x.providerId === id && (!st || x.status === st)).reduce((a, x) => a + x._count, 0);
  return (
    <>
      <h1>Proveedores</h1>
      <div className="grid-main">
        <div className="card">
          {providers.length ? (
            <div className="table-wrap"><table><thead><tr><th>Proveedor</th><th>Contacto</th><th className="r">Códigos</th><th className="r">Disponibles</th><th className="r">Entregados</th><th></th></tr></thead><tbody>
              {providers.map(p => (
                <tr key={p.id}>
                  <td><Link className="link" href={`/admin/licencias?proveedor=${p.id}`}>{p.name}</Link>{p.note && <span className="sub">{p.note}</span>}</td>
                  <td>{p.contact || "—"}</td>
                  <td className="r">{c(p.id)}</td><td className="r">{c(p.id, "DISPONIBLE")}</td><td className="r">{c(p.id, "ENTREGADO")}</td>
                  <td className="r">{c(p.id) === 0 && (
                    <ActionForm action={deleteProviderAction} className="row"><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn danger sm" confirmText="Confirmar">Eliminar</SubmitButton></ActionForm>
                  )}</td>
                </tr>
              ))}
            </tbody></table></div>
          ) : <Empty title="Aún no tienes proveedores">Agrega a quien te vende los códigos para clasificar tu inventario.</Empty>}
        </div>
        <div className="card">
          <h2>Nuevo proveedor</h2>
          <ActionForm action={saveProviderAction} resetOnSuccess>
            <label className="f">Nombre<input className="in" name="name" required /></label>
            <label className="f">Contacto<input className="in" name="contact" placeholder="WhatsApp o correo" /></label>
            <label className="f">Nota<input className="in" name="note" placeholder="Ej. garantía de 25 días" /></label>
            <SubmitButton>Guardar proveedor</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
