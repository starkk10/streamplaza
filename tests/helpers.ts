import { db } from "@/lib/db";
import { hashPassword } from "@/server/auth";
import { addLicenses } from "@/server/licenses";

export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export async function seedBasics(opts: { stock?: number } = {}) {
  const admin = await db.user.create({ data: { email: "admin@test.local", name: "Admin", role: "ADMIN", passwordHash: await hashPassword("admin-password-123") } });
  const customer = await db.user.create({ data: { email: "cliente@test.local", name: "Ana Cliente", phone: "51911111111", role: "CLIENTE", passwordHash: await hashPassword("cliente-password") } });
  const cat = await db.category.create({ data: { name: "Streaming", slug: "streaming" } });
  const product = await db.product.create({
    data: {
      name: "Pantalla Premium", slug: "pantalla-premium", categoryId: cat.id, deliveryType: "LICENCIA", instructions: "Ingresa con el código en la app.",
      plans: { create: [{ name: "1 mes", durationDays: 30, priceCents: 1500 }, { name: "3 meses", durationDays: 90, priceCents: 4000 }] },
    },
    include: { plans: { orderBy: { durationDays: "asc" } } },
  });
  const manual = await db.product.create({
    data: { name: "Soporte Manual", slug: "soporte-manual", deliveryType: "MANUAL", plans: { create: [{ name: "1 mes", durationDays: 30, priceCents: 1000 }] } },
    include: { plans: true },
  });
  const stock = opts.stock ?? 3;
  if (stock > 0) await addLicenses(admin.id, product.id, null, Array.from({ length: stock }, (_, i) => `CODE-${i + 1}-XYZ`).join("\n"));
  return { admin, customer, product, plan1: product.plans[0], plan3: product.plans[1], manual, manualPlan: manual.plans[0] };
}
