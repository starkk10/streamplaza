import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { getSettings } from "@/server/settings";
import { param, type SP } from "@/components/table";

export const dynamic = "force-dynamic";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = param(sp, "q");
  const cat = param(sp, "categoria");
  const s = await getSettings();
  const where: Prisma.ProductWhereInput = {
    active: true,
    plans: { some: { active: true } },
    ...(cat ? { category: { slug: cat } } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { shortDescription: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [categories, products] = await Promise.all([
    db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], where: { products: { some: { active: true } } } }),
    db.product.findMany({ where, include: { plans: { where: { active: true }, orderBy: { priceCents: "asc" } }, category: true }, orderBy: { name: "asc" } }),
  ]);
  const stock = await db.license.groupBy({ by: ["productId"], where: { status: "DISPONIBLE", productId: { in: products.map(p => p.id) } }, _count: true });

  return (
    <>
      <section className="hero">
        <h1>Suscripciones digitales con entrega inmediata</h1>
        <p>Elige tu plan, paga con QR y recibe tu acceso apenas confirmemos el pago. Te avisamos antes de cada vencimiento.</p>
        <form className="toolbar" action="/" method="get">
          <input className="in" style={{ flex: 1, minWidth: 200 }} name="q" defaultValue={q} placeholder="Buscar producto…" aria-label="Buscar producto" />
          {cat && <input type="hidden" name="categoria" value={cat} />}
          <button className="btn" type="submit">Buscar</button>
        </form>
        {categories.length > 0 && (
          <div className="chips">
            <Link className={`chip ${!cat ? "on" : ""}`} href={q ? `/?q=${encodeURIComponent(q)}` : "/"}>Todo</Link>
            {categories.map(c => (
              <Link key={c.id} className={`chip ${cat === c.slug ? "on" : ""}`} href={`/?categoria=${c.slug}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>{c.name}</Link>
            ))}
          </div>
        )}
      </section>

      {products.length ? (
        <div className="products">
          {products.map(p => {
            const available = p.deliveryType === "MANUAL" || (stock.find(x => x.productId === p.id)?._count ?? 0) > 0;
            return (
              <Link key={p.id} href={`/producto/${p.slug}`} className="product">
                <div className="product-img">{p.imageUrl ? <img src={p.imageUrl} alt="" /> : p.name}</div>
                <div className="product-body">
                  <div className="row between"><h3>{p.name}</h3>{!available && <span className="pill mute">Agotado</span>}</div>
                  {p.category && <span className="hint">{p.category.name}</span>}
                  <p className="muted small">{p.shortDescription}</p>
                  <span className="price">desde {formatMoney(p.plans[0].priceCents, s["store.currency"])}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="empty"><b>{q || cat ? "No encontramos productos con ese filtro" : "Todavía no hay productos publicados"}</b>
          {q || cat ? <Link className="link" href="/">Ver todo el catálogo</Link> : "El administrador puede crearlos desde el panel."}</div>
      )}
    </>
  );
}
