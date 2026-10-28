// PostgreSQL local para desarrollo y pruebas, sin Docker.
// Uso: npm run db:local   (deja el servidor corriendo en el puerto 54330)
// En producción usa un PostgreSQL real y no ejecutes este script.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".pgdata-dev");
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "streamplaza",
  password: "streamplaza",
  port: 54330,
  persistent: true,
  // En Windows la codificación por defecto es WIN1252, que no admite emojis de WhatsApp
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
if (fresh) await pg.initialise();
await pg.start();
if (fresh) {
  await pg.createDatabase("streamplaza");
  await pg.createDatabase("streamplaza_test");
}
console.log("PostgreSQL local listo en postgresql://streamplaza:streamplaza@localhost:54330/streamplaza");

const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
