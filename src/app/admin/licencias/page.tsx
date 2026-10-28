import Link from "next/link";
import type { LicenseStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatDate, orderCode } from "@/lib/format";
import { LICENSE_STATUS, Pill } from "@/lib/labels";
import { getSettings } from "@/server/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { RevealCode } from "@/components/reveal";
import { Empty, Filters, Pager, pageOf, param, type SP } from "@/components/table";
import { addLicensesAction, importLicensesAction, licenseStatusAction } from "../actions";

export const metadata = { title: "Códigos y licencias" };
const BASE = "/admin/licencias";

export default async function Licenses({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireStaffPage("licenses.manage");
  const canReveal = can(user.role, "licenses.reveal");
  const tz = (await getSettings())["store.timezone"];
  const productId = param(sp, "producto");
  const status = param(sp, "estado") as LicenseStatus;
  const providerId = param(sp, "proveedor");
  const q = param(sp, "q");
  const where: Prisma.LicenseWhereInput = {
    ...(productId ? { productId } : {}),
    ...(status in LICENSE_STATUS ? { status } : {}),
    ...(providerId ? { providerId } : {}),
    ...(q ? { last4: { contains: q.slice(-4) } } : {}),
  };
  const { page, skip, take } = pageOf(sp);
  const [products, providers, summary, total, licenses] = await Promise.all([
    db.product.findMany({ where: { deliveryType: "LICENCIA" }, orderBy: { name: "asc" } }),
    db.provider.findMany({ orderBy: { name: "asc" } }),
    db.license.groupBy({ by: ["productId", "status"], _count: true }),
    db.license.count({ where }),
    db.license.findMany({ where, include: { product: true, provider: true, orderItem: { include: { order: { include: { customer: true } } } } }, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  const count = (pid: string, st: LicenseStatus) => summary.find(x => x.productId === pid && x.status === st)?._count ?? 0;

  return (
    <>
      <h1>Códigos y licencias</h1>
      <div className="card">
        <h2>Inventario por producto</h2>
        {products.length ? (
          <div className="table-wrap"><table><thead><tr><th>Producto</th><th className="r">Disponibles</th><th className="r">Reservados</th><th className="r">Entregados</th><th className="r">Vencidos</th></tr></thead><tbody>
            {products.map(p => (
              <tr key={p.id}>
                <td><Link className="link" href={`${BASE}?producto=${p.id}`}>{p.name}</Link></td>
                <td className="r">{count(p.id, "DISPONIBLE") <= p.lowStockAlert ? <span className="pill crit">{count(p.id, "DISPONIBLE")}</span> : count(p.id, "DISPONIBLE")}</td>
                <td className="r">{count(p.id, "RESERVADO")}</td><td className="r">{count(p.id, "ENTREGADO")}</td><td className="r">{count(p.id, "VENCIDO")}</td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <Empty title="No hay productos con entrega por código"><Link className="link" href="/admin/productos/nuevo">Crea un producto</Link></Empty>}
      </div>

      {products.length > 0 && (
        <div className="grid-2">
          <div className="card">
            <h2>Registrar códigos</h2>
            <ActionForm action={addLicensesAction} resetOnSuccess>
              <label className="f">Producto<select className="in" name="productId" required defaultValue={productId}>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className="f">Proveedor<select className="in" name="providerId"><option value="">Sin proveedor</option>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className="f">Códigos (uno por línea)<textarea className="in mono" name="codes" required placeholder={"ABCD-1234-EFGH\nIJKL-5678-MNOP"} /></label>
              <label className="f">Vencen el (opcional)<input className="in" name="expires" type="date" /></label>
              <SubmitButton pendingText="Guardando…">Guardar códigos</SubmitButton>
            </ActionForm>
          </div>
          <div className="card">
            <h2>Importar CSV</h2>
            <p className="small muted">Cabecera: <span className="mono">codigo,producto,proveedor,vence</span>. «producto» es el enlace (slug) o el nombre. «vence» en AAAA-MM-DD es opcional. Los códigos repetidos se omiten.</p>
            <pre className="code-box small" style={{ display: "block", whiteSpace: "pre" }}>{"codigo,producto,proveedor,vence\nABCD-1234,netflix-1-pantalla,Proveedor A,2026-12-31"}</pre>
            <ActionForm action={importLicensesAction}>
              <label className="f">Archivo CSV<input className="in" name="file" type="file" accept=".csv,text/csv" required /></label>
              <SubmitButton pendingText="Importando…">Importar</SubmitButton>
            </ActionForm>
          </div>
        </div>
      )}

      <Filters base={BASE} sp={sp} placeholder="Últimos 4 caracteres" selects={[
        { name: "producto", label: "Producto", options: products.map(p => [p.id, p.name]) },
        { name: "estado", label: "Estado", options: Object.entries(LICENSE_STATUS).map(([k, v]) => [k, v[0]]) },
        { name: "proveedor", label: "Proveedor", options: providers.map(p => [p.id, p.name]) },
      ]} />
      <div className="card">
        {licenses.length ? (
          <>
            <div className="table-wrap"><table><thead><tr><th>Código</th><th>Producto</th><th>Proveedor</th><th>Estado</th><th>Asignado a</th><th>Vence</th><th></th></tr></thead><tbody>
              {licenses.map(l => (
                <tr key={l.id}>
                  <td>{canReveal ? <RevealCode id={l.id} last4={l.last4} /> : <span className="mono">•••• {l.last4}</span>}</td>
                  <td>{l.product.name}</td>
                  <td>{l.provider?.name ?? "—"}</td>
                  <td><Pill v={LICENSE_STATUS[l.status]} /></td>
                  <td>{l.orderItem ? <><Link className="link mono" href={`/admin/pedidos/${l.orderItem.orderId}`}>{orderCode(l.orderItem.order.number)}</Link><span className="sub">{l.orderItem.order.customer.name}</span></> : "—"}</td>
                  <td>{formatDate(l.expiresAt, tz)}</td>
                  <td className="r">
                    {l.status === "DISPONIBLE" && (
                      <span className="row" style={{ justifyContent: "flex-end" }}>
                        <ActionForm action={licenseStatusAction} className="row"><input type="hidden" name="id" value={l.id} /><input type="hidden" name="op" value="expire" /><SubmitButton className="btn ghost sm" confirmText="Confirmar">Marcar vencido</SubmitButton></ActionForm>
                        <ActionForm action={licenseStatusAction} className="row"><input type="hidden" name="id" value={l.id} /><input type="hidden" name="op" value="delete" /><SubmitButton className="btn danger sm" confirmText="Confirmar">Eliminar</SubmitButton></ActionForm>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody></table></div>
            <Pager base={BASE} sp={sp} total={total} page={page} />
          </>
        ) : <Empty title="No hay códigos con ese filtro" />}
        {!canReveal && <p className="hint">Solo un administrador puede ver los códigos completos.</p>}
      </div>
    </>
  );
}
