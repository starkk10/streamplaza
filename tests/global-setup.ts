import { execSync } from "node:child_process";

// Aplica las migraciones a la base de datos de pruebas
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://streamplaza:streamplaza@localhost:54330/streamplaza_test";
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
