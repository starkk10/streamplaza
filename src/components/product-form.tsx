import type { Category, Product } from "@prisma/client";
import { ActionForm, SubmitButton } from "./forms";
import { saveProductAction } from "@/app/admin/actions";

export function ProductForm({ product, categories }: { product?: Product; categories: Category[] }) {
  return (
    <ActionForm action={saveProductAction} className="form-2">
      {product && <input type="hidden" name="id" value={product.id} />}
      <label className="f">Nombre<input className="in" name="name" required defaultValue={product?.name} maxLength={80} /></label>
      <label className="f">Enlace (slug)<input className="in" name="slug" defaultValue={product?.slug} placeholder="Se genera del nombre" /></label>
      <label className="f">Categoría
        <select className="in" name="categoryId" defaultValue={product?.categoryId ?? ""}>
          <option value="">Sin categoría</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="f">Tipo de entrega
        <select className="in" name="deliveryType" defaultValue={product?.deliveryType ?? "LICENCIA"}>
          <option value="LICENCIA">Código o licencia del inventario (automática)</option>
          <option value="MANUAL">Manual (un empleado entrega el acceso)</option>
        </select>
      </label>
      <label className="f full">Descripción corta<input className="in" name="shortDescription" maxLength={200} defaultValue={product?.shortDescription} /></label>
      <label className="f full">Descripción y características<textarea className="in" name="description" maxLength={5000} defaultValue={product?.description} /></label>
      <label className="f full">Instrucciones de uso (el cliente las ve tras la entrega)<textarea className="in" name="instructions" maxLength={3000} defaultValue={product?.instructions} /></label>
      <label className="f">Imagen (enlace)<input className="in" name="imageUrl" defaultValue={product?.imageUrl ?? ""} placeholder="https://…" /></label>
      <label className="f">o sube una imagen<input className="in" name="image" type="file" accept="image/png,image/jpeg,image/webp" /></label>
      <label className="f">Avisar cuando queden<input className="in" name="lowStockAlert" type="number" min={0} defaultValue={product?.lowStockAlert ?? 3} /><span className="hint">códigos disponibles o menos</span></label>
      <label className="check"><input type="checkbox" name="active" defaultChecked={product?.active ?? true} /> Visible en la tienda</label>
      <div className="full"><SubmitButton pendingText="Guardando…">{product ? "Guardar cambios" : "Crear producto"}</SubmitButton></div>
    </ActionForm>
  );
}
