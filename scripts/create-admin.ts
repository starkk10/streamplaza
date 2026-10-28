// Crea o actualiza el primer administrador con ADMIN_EMAIL y ADMIN_PASSWORD del .env
import { db } from "@/lib/db";
import { hashPassword } from "@/server/auth";

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || password.length < 10) {
    console.error("Define ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 10 caracteres) en el archivo .env");
    process.exit(1);
  }
  const passwordHash = await hashPassword(password);
  const user = await db.user.upsert({
    where: { email },
    create: { email, name: "Administrador", passwordHash, role: "ADMIN" },
    update: { passwordHash, role: "ADMIN", active: true },
  });
  console.log(`Administrador listo: ${user.email}`);
}

main().finally(() => db.$disconnect());
