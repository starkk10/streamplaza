import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { ProductForm } from "@/components/product-form";
import { ActionForm, SubmitButton } from "@/components/forms";
import { savePlanAction } from "../../actions";

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStaffPage("products.manage");
  const [product, categories] = await Promise.all([
    db.product.findUnique({ where: { id }, include: { plans: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }], include: { _count: { select: { orderItems: true } } } } } }),
    db.category.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!product) notFound();
  const stock = await db.license.groupBy({ by: ["status"], where: { productId: id }, _count: true });

  return (
    <>
      <Link className="link small" href="/admin/productos">← Productos</Link>
      <div className="topbar">
        <h1>{product.name}</h1>
        <div className="row">
          <Link className="btn ghost sm" href={`/producto/${product.slug}`} target="_blank">Ver en la tienda</Link>
          {product.deliveryType === "LICENCIA" && <Link className="btn ghost sm" href={`/admin/licencias?producto=${product.id}`}>Códigos: {stock.find(s => s.status === "DISPONIBLE")?._count ?? 0} disponibles</Link>}
        </div>
      </div>
      <div className="grid-main">
        <div className="card"><h2>Datos del producto</h2><ProductForm product={product} categories={categories} /></div>
        <div className="card">
          <h2>Planes y precios</h2>
          {product.plans.map(pl => (
            <ActionForm key={pl.id} action={savePlanAction} className="form" >
              <input type="hidden" name="planId" value={pl.id} />
              <input type="hidden" name="productId" value={product.id} />
              <div className="form-2">
                <label className="f">Nombre<input className="in" name="name" defaultValue={pl.name} required /></label>
                <label className="f">Días<input className="in" name="durationDays" type="number" min={1} defaultValue={pl.durationDays} required /></label>
                <label className="f">Precio<input className="in" name="price" inputMode="decimal" defaultValue={(pl.priceCents / 100).toFixed(2)} required /></label>
                <label className="f">Orden<input className="in" name="sortOrder" type="number" defaultValue={pl.sortOrder} /></label>
              </div>
              <div className="row between">
                <label className="check"><input type="checkbox" name="active" defaultChecked={pl.active} /> Activo</label>
                <span className="hint">{pl._count.orderItems} ventas</span>
                <SubmitButton className="btn ghost sm">Guardar plan</SubmitButton>
              </div>
            </ActionForm>
          ))}
          <h3>Agregar plan</h3>
          <ActionForm action={savePlanAction} className="form" resetOnSuccess>
            <input type="hidden" name="productId" value={product.id} />
            <div className="form-2">
              <label className="f">Nombre<input className="in" name="name" required placeholder="Ej. 1 mes" /></label>
              <label className="f">Días<input className="in" name="durationDays" type="number" min={1} required placeholder="30" /></label>
              <label className="f">Precio<input className="in" name="price" inputMode="decimal" required placeholder="15.00" /></label>
              <label className="f">Orden<input className="in" name="sortOrder" type="number" defaultValue={product.plans.length} /></label>
            </div>
            <label className="check"><input type="checkbox" name="active" defaultChecked /> Activo</label>
            <SubmitButton>Agregar plan</SubmitButton>
          </ActionForm>
          <p className="hint">Cambiar un precio no modifica los pedidos ya creados. Desactiva un plan en lugar de borrarlo para conservar el historial.</p>
        </div>
      </div>
    </>
  );
}
