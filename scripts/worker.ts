// Proceso de tareas programadas. Ejecútalo junto al servidor web: npm run worker
// Cada minuto: envía avisos pendientes. Cada 15 minutos: vencimientos, recordatorios, licencias y pedidos sin pago.
import { db } from "@/lib/db";
import { runScheduledJobs } from "@/server/jobs";
import { processNotificationQueue } from "@/server/notifications";

let running = false;
let tick = 0;

async function loop() {
  if (running) return;
  running = true;
  try {
    if (tick % 15 === 0) {
      const r = await runScheduledJobs();
      console.log(new Date().toISOString(), "tareas", JSON.stringify(r));
    } else {
      const q = await processNotificationQueue();
      if (q.sent || q.failed || q.skipped) console.log(new Date().toISOString(), "avisos", JSON.stringify(q));
    }
  } catch (e) {
    console.error(new Date().toISOString(), "[worker] error", e);
  } finally {
    tick++;
    running = false;
  }
}

if (process.argv.includes("--once")) {
  runScheduledJobs().then(r => { console.log(JSON.stringify(r, null, 2)); return db.$disconnect(); });
} else {
  console.log("Worker iniciado");
  loop();
  setInterval(loop, 60_000);
  const stop = async () => { await db.$disconnect(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
