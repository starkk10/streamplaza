import { expireLicenses } from "./licenses";
import { processNotificationQueue } from "./notifications";
import { cancelStaleOrders, runSubscriptionJobs } from "./subscriptions";

/** Todas las tareas programadas. Es seguro ejecutarlas varias veces: no repiten avisos ni cambios. */
export async function runScheduledJobs(now = new Date()) {
  const licenses = await expireLicenses(now);
  const orders = await cancelStaleOrders(now);
  const subs = await runSubscriptionJobs(now);
  const queue = await processNotificationQueue(200);
  return { licenciasVencidas: licenses, pedidosCancelados: orders, ...subs, avisos: queue };
}
