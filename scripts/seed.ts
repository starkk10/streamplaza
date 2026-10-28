// Datos de DEMOSTRACIÓN solo para desarrollo local. No lo ejecutes en producción.
import { db } from "@/lib/db";
import { addLicenses } from "@/server/licenses";

async function main() {
  if (process.env.NODE_ENV === "production" || !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    console.error("seed.ts solo se ejecuta contra una base de datos local. Crea tus productos reales desde el panel.");
    process.exit(1);
  }
  const admin = await db.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) { console.error("Primero crea el administrador: npm run admin:create"); process.exit(1); }

  const cat = await db.category.upsert({ where: { slug: "demo-streaming" }, create: { name: "Streaming (demo)", slug: "demo-streaming" }, update: {} });
  const product = await db.product.upsert({
    where: { slug: "demo-pantalla" },
    create: {
      name: "Pantalla demo", slug: "demo-pantalla", categoryId: cat.id, deliveryType: "LICENCIA",
      shortDescription: "Producto de demostración para probar el flujo de compra.",
      description: "Este producto existe solo en tu entorno local. Bórralo o desactívalo antes de publicar.",
      instructions: "Instrucciones de ejemplo: abre la app e ingresa el código recibido.",
      plans: { create: [{ name: "1 mes", durationDays: 30, priceCents: 1500, sortOrder: 0 }, { name: "3 meses", durationDays: 90, priceCents: 4000, sortOrder: 1 }] },
    },
    update: {},
  });
  const r = await addLicenses(admin.id, product.id, null, Array.from({ length: 5 }, (_, i) => `DEMO-${Date.now().toString(36)}-${i + 1}`).join("\n"));
  console.log(`Demo lista: producto "${product.name}" con ${r.added} códigos de prueba.`);
}

main().finally(() => db.$disconnect());
