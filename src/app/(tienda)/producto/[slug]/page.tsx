import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { getSettings } from "@/server/settings";
import { AddToCart } from "@/components/cart";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  return db.product.findFirst({
    where: { slug, active: true },
    include: { plans: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] }, category: true },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await load((await params).slug);
  return { title: p?.name ?? "Producto", description: p?.shortDescription };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const s = await getSettings();
  const stock = p.deliveryType === "LICENCIA" ? await db.license.count({ where: { productId: p.id, status: "DISPONIBLE" } }) : null;

  return (
    <>
      <nav className="small muted"><Link className="link" href="/">Tienda</Link>{p.category && <> / <Link className="link" href={`/?categoria=${p.category.slug}`}>{p.category.name}</Link></>}</nav>
      <div className="grid-main">
        <div className="card">
          <div className="product-img" style={{ borderRadius: 12, overflow: "hidden" }}>{p.imageUrl ? <img src={p.imageUrl} alt={p.name} /> : p.name}</div>
          <h1>{p.name}</h1>
          {p.shortDescription && <p className="muted">{p.shortDescription}</p>}
          {p.description && <div className="prose">{p.description}</div>}
        </div>
        <div className="card">
          <h2>Elige tu plan</h2>
          {stock === 0 ? (
            <div className="alert warn">Agotado por ahora. Escríbenos por WhatsApp y te avisamos cuando haya stock.</div>
          ) : (
            <AddToCart plans={p.plans.map(pl => ({ id: pl.id, label: pl.name, price: formatMoney(pl.priceCents, s["store.currency"]), days: pl.durationDays }))} />
          )}
          {stock !== null && stock > 0 && stock <= 5 && <p className="hint">Quedan {stock} disponibles.</p>}
          <p className="hint">Entrega {p.deliveryType === "LICENCIA" ? "automática apenas se apruebe tu pago" : "manual por nuestro equipo después de aprobar tu pago"}.</p>
        </div>
      </div>
    </>
  );
}
