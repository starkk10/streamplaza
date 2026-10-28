import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { authenticate, registerCustomer } from "@/server/auth";
import { cancelOrder, createOrder } from "@/server/orders";
import { approvePayment, refundPayment, rejectPayment, submitPayment } from "@/server/payments";
import { deliverItemManually, retryDelivery } from "@/server/delivery";
import { addLicenses, importLicensesCsv } from "@/server/licenses";
import { requestRenewal, runSubscriptionJobs, cancelStaleOrders } from "@/server/subscriptions";
import { processNotificationQueue } from "@/server/notifications";
import { resetDb, seedBasics } from "./helpers";

afterAll(async () => { await db.$disconnect(); });

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => { await resetDb(); s = await seedBasics(); });

async function pay(orderId: string, reference: string, amount: number) {
  return submitPayment({ orderId, auth: { customerId: s.customer.id }, reference, amountCents: amount, receiptPath: "x.png" });
}

describe("registro e inicio de sesión", () => {
  it("registra un cliente y valida la contraseña", async () => {
    const u = await registerCustomer({ name: "Luis", email: "Luis@Mail.com", password: "secreta123", phone: "+51 922 333 444" });
    expect(u.email).toBe("luis@mail.com");
    expect(u.phone).toBe("51922333444");
    expect(u.passwordHash).not.toContain("secreta");
    await expect(authenticate("luis@mail.com", "mala-clave")).rejects.toThrow("incorrectos");
    expect((await authenticate("LUIS@mail.com", "secreta123")).id).toBe(u.id);
    await expect(registerCustomer({ name: "Otro", email: "luis@mail.com", password: "secreta123" })).rejects.toThrow("Ya existe");
  });

  it("un cliente que compró por WhatsApp reclama su número al registrarse", async () => {
    const wa = await db.user.create({ data: { name: "Cliente WA", phone: "51933000000" } });
    const u = await registerCustomer({ name: "Rosa", email: "rosa@mail.com", password: "secreta123", phone: "51933000000" });
    expect(u.id).toBe(wa.id);
  });
});

describe("pedidos", () => {
  it("usa los precios de la base de datos, aplica cupón y reserva stock", async () => {
    await db.coupon.create({ data: { code: "PROMO10", type: "PORCENTAJE", value: 10, maxUses: 1 } });
    const o = await createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 2 }], couponCode: "promo10" });
    expect(o.subtotalCents).toBe(3000);
    expect(o.discountCents).toBe(300);
    expect(o.totalCents).toBe(2700);
    expect(await db.license.count({ where: { status: "RESERVADO" } })).toBe(2);
    await expect(createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }], couponCode: "PROMO10" })).rejects.toThrow("límite");
  });

  it("no vende más de lo que hay en inventario", async () => {
    await expect(createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 4 }] })).rejects.toThrow("agotado");
    expect(await db.order.count()).toBe(0);
    expect(await db.license.count({ where: { status: "DISPONIBLE" } })).toBe(3);
  });

  it("dos pedidos simultáneos no reservan el mismo código", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }] })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(3);
    const reserved = await db.license.findMany({ where: { status: "RESERVADO" } });
    expect(new Set(reserved.map(l => l.orderItemId)).size).toBe(3);
  });

  it("el mismo envío repetido no crea dos pedidos", async () => {
    const a = await createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }], idempotencyKey: "k1" });
    const b = await createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }], idempotencyKey: "k1" });
    expect(b.id).toBe(a.id);
    expect(await db.order.count()).toBe(1);
  });

  it("cancelar libera el stock reservado", async () => {
    const o = await createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }] });
    await cancelOrder(o.id, s.admin.id, "Cliente desistió");
    expect(await db.license.count({ where: { status: "DISPONIBLE", orderItemId: null } })).toBe(3);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("CANCELADO");
  });

  it("cancela automáticamente pedidos sin pago después de 48 h", async () => {
    const o = await createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }] });
    expect(await cancelStaleOrders(new Date(Date.now() + 49 * 3600_000))).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("CANCELADO");
    expect(await db.license.count({ where: { status: "DISPONIBLE" } })).toBe(3);
  });
});

describe("pagos y entrega", () => {
  it("aprueba el pago, entrega un código único y crea la suscripción", async () => {
    const o = await createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }] });
    const p = await pay(o.id, "op-123456", 1500);
    expect(p.reference).toBe("OP123456");
    await expect(approvePayment(p.id, s.admin.id, 1400)).rejects.toThrow("exactamente");
    const r = await approvePayment(p.id, s.admin.id, 1500);
    expect(r.complete).toBe(true);
    const order = await db.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: { include: { license: true, subscription: true } } } });
    expect(order.status).toBe("ENTREGADO");
    expect(order.items[0].license?.status).toBe("ENTREGADO");
    expect(decrypt(order.items[0].license!.codeEnc)).toMatch(/^CODE-\d-XYZ$/);
    expect(order.items[0].subscription?.status).toBe("ACTIVA");
    await expect(approvePayment(p.id, s.admin.id, 1500)).rejects.toThrow("ya fue revisado");
  });

  it("aprobaciones simultáneas del mismo pago entregan una sola vez", async () => {
    const o = await createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }] });
    const p = await pay(o.id, "OP999", 1500);
    const rs = await Promise.allSettled([approvePayment(p.id, s.admin.id, 1500), approvePayment(p.id, s.admin.id, 1500), approvePayment(p.id, s.admin.id, 1500)]);
    expect(rs.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.license.count({ where: { status: "ENTREGADO" } })).toBe(1);
    expect(await db.subscription.count()).toBe(1);
  });

  it("rechaza números de operación repetidos y comprobantes duplicados", async () => {
    const o1 = await createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }] });
    const o2 = await createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }] });
    await pay(o1.id, "OP555", 1500);
    await expect(pay(o1.id, "OP556", 1500)).rejects.toThrow("Ya enviaste");
    await expect(pay(o2.id, "OP555", 1500)).rejects.toThrow("ya fue registrado");
    await expect(submitPayment({ orderId: o2.id, auth: { accessToken: "token-falso" }, reference: "OP777", amountCents: 1500, receiptPath: "x.png" })).rejects.toThrow("No encontramos");
    await expect(submitPayment({ orderId: o2.id, auth: { accessToken: o2.accessToken }, reference: "OP777", amountCents: 1500, receiptPath: "x.png" })).resolves.toBeTruthy();
  });

  it("un pago rechazado permite enviar otro comprobante", async () => {
    const o = await createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }] });
    const p = await pay(o.id, "OP100", 1500);
    await rejectPayment(p.id, s.admin.id, "El comprobante no se lee");
    const p2 = await pay(o.id, "OP101", 1500);
    expect(p2.status).toBe("EN_REVISION");
  });

  it("si falta inventario queda PROCESADO y se completa al reintentar", async () => {
    const o = await createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }] });
    // Simula un código reservado que se perdió (por ejemplo, eliminado por error)
    await db.license.updateMany({ where: { status: "RESERVADO" }, data: { status: "VENCIDO", orderItemId: null } });
    await db.license.updateMany({ where: { status: "DISPONIBLE" }, data: { status: "VENCIDO" } });
    const p = await pay(o.id, "OP200", 1500);
    const r = await approvePayment(p.id, s.admin.id, 1500);
    expect(r.complete).toBe(false);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PROCESADO");
    await addLicenses(s.admin.id, s.product.id, null, "NUEVO-CODIGO-1");
    const r2 = await retryDelivery(o.id, s.admin.id);
    expect(r2.complete).toBe(true);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("ENTREGADO");
  });

  it("entrega manual para productos sin código", async () => {
    const o = await createOrder({ customerId: s.customer.id, items: [{ planId: s.manualPlan.id, qty: 1 }] });
    const p = await pay(o.id, "OP300", 1000);
    const r = await approvePayment(p.id, s.admin.id, 1000);
    expect(r.manualPending).toEqual(["Soporte Manual"]);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
    await deliverItemManually(item.id, "Acceso enviado al correo del cliente", s.admin.id);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("ENTREGADO");
    await expect(deliverItemManually(item.id, "otra vez", s.admin.id)).rejects.toThrow("ya fue entregado");
  });

  it("el reembolso cancela el pedido y la suscripción", async () => {
    const o = await createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }] });
    const p = await pay(o.id, "OP400", 1500);
    await approvePayment(p.id, s.admin.id, 1500);
    await refundPayment(p.id, s.admin.id, "Cliente pidió devolución");
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("CANCELADO");
    expect((await db.subscription.findFirstOrThrow()).status).toBe("CANCELADA");
  });
});

describe("suscripciones y tareas programadas", () => {
  async function delivered() {
    const o = await createOrder({ customerId: s.customer.id, items: [{ planId: s.plan1.id, qty: 1 }] });
    const p = await pay(o.id, "OP" + Math.floor(Math.random() * 1e9), 1500);
    await approvePayment(p.id, s.admin.id, 1500);
    return db.subscription.findFirstOrThrow({ where: { orderItem: { orderId: o.id } } });
  }

  it("la renovación suma días desde el vencimiento sin consumir otro código", async () => {
    const sub = await delivered();
    const o = await requestRenewal(sub.id, s.customer.id, s.plan3.id);
    expect(o.totalCents).toBe(4000);
    await expect(requestRenewal(sub.id, s.customer.id, s.plan1.id)).rejects.toThrow("renovación en curso");
    const p = await pay(o.id, "OPREN1", 4000);
    await approvePayment(p.id, s.admin.id, 4000);
    const after = await db.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(Math.round((after.endAt.getTime() - sub.endAt.getTime()) / 86400000)).toBe(90);
    expect(await db.license.count({ where: { status: "ENTREGADO" } })).toBe(1);
    expect(await db.subscriptionEvent.count({ where: { subscriptionId: sub.id, type: "RENOVACION" } })).toBe(1);
  });

  it("otro cliente no puede renovar una suscripción ajena", async () => {
    const sub = await delivered();
    const other = await db.user.create({ data: { name: "Otro", email: "otro@test.local" } });
    await expect(requestRenewal(sub.id, other.id, s.plan1.id)).rejects.toThrow("No encontramos");
  });

  it("los recordatorios no se repiten y los vencimientos se marcan", async () => {
    const sub = await delivered();
    const threeDaysBefore = new Date(sub.endAt.getTime() - 3 * 86400000);
    const a = await runSubscriptionJobs(threeDaysBefore);
    const b = await runSubscriptionJobs(threeDaysBefore);
    expect(a.reminders).toBeGreaterThan(0);
    const count = await db.notification.count({ where: { event: "subscription.reminder" } });
    expect(count).toBe(a.reminders);
    expect(b.reminders).toBe(a.reminders); // se intentan otra vez, pero la deduplicación evita filas nuevas
    expect(await db.notification.count({ where: { event: "subscription.reminder" } })).toBe(count);
    const r = await runSubscriptionJobs(new Date(sub.endAt.getTime() + 3600_000));
    expect(r.expired).toBe(1);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("VENCIDA");
  });

  it("sin credenciales los avisos quedan omitidos, no enviados", async () => {
    await delivered();
    const q = await processNotificationQueue(500);
    expect(q.sent).toBe(0);
    expect(await db.notification.count({ where: { status: "ENVIADA" } })).toBe(0);
    expect(await db.notification.count({ where: { status: "OMITIDA" } })).toBeGreaterThan(0);
  });
});

describe("licencias", () => {
  it("cifra los códigos y no admite duplicados al importar CSV", async () => {
    const r = await importLicensesCsv(s.admin.id, "codigo,producto,proveedor,vence\nABC-111,pantalla-premium,Proveedor Uno,2030-01-31\nABC-111,pantalla-premium,Proveedor Uno,\nCODE-1-XYZ,pantalla-premium,,\nZZZ,no-existe,,");
    expect(r.added).toBe(1);
    expect(r.duplicates).toHaveLength(2);
    expect(r.errors[0]).toContain("no existe");
    const raw = await db.$queryRaw<{ codeEnc: string }[]>`SELECT "codeEnc" FROM "License"`;
    expect(raw.every(x => !x.codeEnc.includes("ABC-111"))).toBe(true);
    expect(await db.provider.count({ where: { name: "Proveedor Uno" } })).toBe(1);
  });
});
