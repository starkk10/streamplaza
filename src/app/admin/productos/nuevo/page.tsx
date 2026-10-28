import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { ProductForm } from "@/components/product-form";

export const metadata = { title: "Nuevo producto" };

export default async function NewProduct() {
  await requireStaffPage("products.manage");
  const categories = await db.category.findMany({ orderBy: { name: "asc" } });
  return (
    <>
      <Link className="link small" href="/admin/productos">← Productos</Link>
      <h1>Nuevo producto</h1>
      <div className="card"><ProductForm categories={categories} /><p className="hint">Después de crearlo podrás agregar sus planes y precios.</p></div>
    </>
  );
}
