import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { formatMoney } from "@/lib/format";
import { getSettings } from "@/server/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Empty, Filters, param, type SP } from "@/components/table";
import { deleteCategoryAction, saveCategoryAction } from "../actions";

export const metadata = { title: "Productos" };

export default async function Products({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireStaffPage("products.manage");
  const currency = (await getSettings())["store.currency"];
  const q = param(sp, "q");
  const [products, categories, stock] = await Promise.all([
    db.product.findMany({ where: q ? { name: { contains: q, mode: "insensitive" } } : {}, include: { plans: { orderBy: { priceCents: "asc" } }, category: true }, orderBy: { name: "asc" } }),
    db.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.license.groupBy({ by: ["productId"], where: { status: "DISPONIBLE" }, _count: true }),
  ]);
  return (
    <>
      <div className="topbar"><h1>Productos y planes</h1><Link className="btn" href="/admin/productos/nuevo">Nuevo producto</Link></div>
      <Filters base="/admin/productos" sp={sp} placeholder="Nombre del producto" />
      <div className="grid-main">
        <div className="card">
          {products.length ? (
            <div className="table-wrap"><table><thead><tr><th>Producto</th><th>Categoría</th><th>Planes</th><th>Entrega</th><th className="r">Stock</th></tr></thead><tbody>
              {products.map(p => (
                <tr key={p.id}>
                  <td><Link className="link" href={`/admin/productos/${p.id}`}>{p.name}</Link>{!p.active && <span className="sub">Oculto en la tienda</span>}</td>
                  <td>{p.category?.name ?? "—"}</td>
                  <td>{p.plans.length ? p.plans.map(pl => `${pl.name} ${formatMoney(pl.priceCents, currency)}${pl.active ? "" : " (inactivo)"}`).join(" · ") : <span className="pill warn">Sin planes</span>}</td>
                  <td>{p.deliveryType === "LICENCIA" ? "Código automático" : "Manual"}</td>
                  <td className="r">{p.deliveryType === "LICENCIA" ? stock.find(s => s.productId === p.id)?._count ?? 0 : "—"}</td>
                </tr>
              ))}
            </tbody></table></div>
          ) : <Empty title="Todavía no hay productos"><Link className="link" href="/admin/productos/nuevo">Crea el primero</Link></Empty>}
        </div>
        <div className="card">
          <h2>Categorías</h2>
          {categories.map(c => (
            <ActionForm key={c.id} action={deleteCategoryAction} className="row between">
              <input type="hidden" name="id" value={c.id} />
              <span>{c.name} <span className="muted small">({c._count.products})</span></span>
              <SubmitButton className="btn ghost sm" confirmText="Confirmar">Eliminar</SubmitButton>
            </ActionForm>
          ))}
          <ActionForm action={saveCategoryAction} className="form" resetOnSuccess>
            <label className="f">Nueva categoría<input className="in" name="name" required placeholder="Ej. Música" /></label>
            <label className="f">Orden<input className="in" name="sortOrder" type="number" defaultValue={0} /></label>
            <SubmitButton className="btn ghost">Agregar categoría</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
