import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Order, OrderItem, Payment, User } from "@prisma/client";
import { formatDateTime, formatMoney, orderCode } from "@/lib/format";
import type { Settings } from "./settings";

// Las fuentes estándar de PDF no tienen todos los caracteres; se reemplazan los que no admiten.
const clean = (s: string) => s.normalize("NFC").replace(/[^\x20-\x7E -ÿ]/g, "?");

/** Comprobante de compra en PDF (no es una factura electrónica oficial). */
export async function buildReceiptPdf(order: Order & { items: OrderItem[]; payments: Payment[]; customer: User }, s: Settings) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const tz = s["store.timezone"];
  let y = 790;
  const text = (t: string, x: number, size = 11, f = font, color = rgb(0.1, 0.12, 0.2)) => page.drawText(clean(t), { x, y, size, font: f, color });

  text(s["store.name"], 50, 20, bold);
  y -= 22; text("Comprobante de compra", 50, 12, font, rgb(0.4, 0.42, 0.5));
  y -= 40; text(`Pedido ${orderCode(order.number)}`, 50, 14, bold);
  text(`Fecha: ${formatDateTime(order.createdAt, tz)}`, 330);
  y -= 18; text(`Cliente: ${order.customer.name}`, 50);
  text(`Estado: ${order.status}`, 330);
  if (order.customer.email) { y -= 16; text(`Correo: ${order.customer.email}`, 50); }
  if (order.customer.phone) { y -= 16; text(`WhatsApp: +${order.customer.phone}`, 50); }

  y -= 34; text("Producto", 50, 11, bold); text("Duración", 330, 11, bold); text("Importe", 470, 11, bold);
  y -= 8; page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.7, color: rgb(0.8, 0.82, 0.88) });
  for (const it of order.items) {
    y -= 20;
    text(`${it.productName} - ${it.planName}`.slice(0, 50), 50);
    text(`${it.durationDays} días`, 330);
    text(formatMoney(it.unitPriceCents, order.currency), 470);
  }
  y -= 14; page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.7, color: rgb(0.8, 0.82, 0.88) });
  y -= 20; text("Subtotal", 330); text(formatMoney(order.subtotalCents, order.currency), 470);
  if (order.discountCents) { y -= 18; text("Descuento", 330); text("- " + formatMoney(order.discountCents, order.currency), 470); }
  y -= 20; text("Total", 330, 12, bold); text(formatMoney(order.totalCents, order.currency), 470, 12, bold);

  const paid = order.payments.find(p => p.status === "APROBADO" || p.status === "REEMBOLSADO");
  if (paid) {
    y -= 40; text("Pago", 50, 11, bold);
    y -= 18; text(`Método: ${paid.method}  ·  Operación: ${paid.reference}`, 50);
    y -= 16; text(`Aprobado: ${formatDateTime(paid.reviewedAt, tz)}${paid.status === "REEMBOLSADO" ? "  ·  REEMBOLSADO" : ""}`, 50);
  }
  y = 60;
  text("Este documento es un comprobante interno de compra y no reemplaza a una factura o boleta electrónica.", 50, 8, font, rgb(0.45, 0.47, 0.55));
  return Buffer.from(await pdf.save());
}
