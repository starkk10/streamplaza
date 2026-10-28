"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { checkoutAction, quoteAction, type QuoteView } from "@/app/(tienda)/actions";

type Line = { planId: string; qty: number };
const KEY = "sp-cart";
const listeners = new Set<() => void>();

function read(): Line[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(lines: Line[]) {
  try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* sin almacenamiento: el carrito dura hasta recargar */ }
  cache = JSON.stringify(lines);
  listeners.forEach(l => l());
}
let cache = "[]";
function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = e.newValue ?? "[]"; cb(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}
function useCart(): Line[] {
  const raw = useSyncExternalStore(subscribe, () => { const s = JSON.stringify(read()); if (s !== cache) cache = s; return cache; }, () => "[]");
  return JSON.parse(raw);
}

export function addToCart(planId: string, qty = 1) {
  const lines = read();
  const cur = lines.find(l => l.planId === planId);
  if (cur) cur.qty = Math.min(5, cur.qty + qty); else lines.push({ planId, qty });
  write(lines.slice(0, 10));
}

export function CartLink() {
  const n = useCart().reduce((a, l) => a + l.qty, 0);
  return <Link href="/carrito">Carrito{n > 0 && <span className="cart-count">{n}</span>}</Link>;
}

export function AddToCart({ plans }: { plans: { id: string; label: string; price: string; days: number }[] }) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [added, setAdded] = useState(false);
  const router = useRouter();
  if (!plans.length) return <div className="alert info">Este producto no tiene planes disponibles por ahora.</div>;
  return (
    <div className="stack">
      <div className="plans" role="radiogroup" aria-label="Elige un plan">
        {plans.map(p => (
          <label key={p.id} className="plan-opt">
            <span className="row"><input type="radio" name="plan" value={p.id} checked={planId === p.id} onChange={() => setPlanId(p.id)} />
              <span><b>{p.label}</b><span className="hint" style={{ display: "block" }}>{p.days} días de acceso</span></span></span>
            <span className="price">{p.price}</span>
          </label>
        ))}
      </div>
      <div className="row">
        <button className="btn green" type="button" onClick={() => { addToCart(planId); setAdded(true); }}>Agregar al carrito</button>
        <button className="btn ghost" type="button" onClick={() => { addToCart(planId); router.push("/carrito"); }}>Comprar ahora</button>
      </div>
      {added && <div className="alert ok" role="status">Agregado. <Link className="link" href="/carrito">Ver carrito</Link></div>}
    </div>
  );
}

export function CartView({ loggedIn }: { loggedIn: boolean }) {
  const lines = useCart();
  const router = useRouter();
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2)));
  const linesKey = JSON.stringify(lines);

  const refresh = useCallback(async (code: string | null) => {
    const items: Line[] = JSON.parse(linesKey);
    if (!items.length) { setQuote(null); setLoading(false); return; }
    setLoading(true);
    const r = await quoteAction(items, code);
    setLoading(false);
    if (r.ok) { setQuote(r.data!); setError(null); setApplied(r.data!.coupon); }
    else {
      setError(r.error);
      // Si el cupón falla, vuelve a calcular sin cupón para mostrar el carrito
      if (code) { const r2 = await quoteAction(items, null); if (r2.ok) setQuote(r2.data!); setApplied(null); }
    }
  }, [linesKey]);

  useEffect(() => { refresh(applied); }, [linesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setQty = (planId: string, qty: number) => write(read().map(l => l.planId === planId ? { ...l, qty } : l).filter(l => l.qty > 0));

  if (!lines.length) return <div className="empty"><b>Tu carrito está vacío</b>Elige un producto en la <Link className="link" href="/">tienda</Link>.</div>;

  return (
    <div className="grid-main">
      <div className="card">
        <h2>Tu carrito</h2>
        {loading && !quote && <p className="muted">Calculando precios…</p>}
        {quote && (
          <div className="table-wrap"><table><thead><tr><th>Producto</th><th>Cantidad</th><th className="r">Importe</th></tr></thead><tbody>
            {quote.lines.map(l => (
              <tr key={l.planId}>
                <td><Link className="link" href={`/producto/${l.slug}`}>{l.product}</Link><span className="sub">{l.plan} · {l.durationDays} días · {l.unit} c/u</span></td>
                <td><select className="in" style={{ width: 80 }} aria-label={`Cantidad de ${l.product}`} value={l.qty} onChange={e => setQty(l.planId, Number(e.target.value))}>
                  {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n === 0 ? "Quitar" : n}</option>)}
                </select></td>
                <td className="r">{l.line}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        {error && <div className="alert err" role="alert">{error}</div>}
      </div>
      <div className="card">
        <h2>Resumen</h2>
        <form className="row" onSubmit={e => { e.preventDefault(); refresh(coupon.trim() || null); }}>
          <input className="in" style={{ flex: 1, minWidth: 0 }} placeholder="Cupón de descuento" aria-label="Cupón de descuento" value={coupon} onChange={e => setCoupon(e.target.value)} />
          <button className="btn ghost" type="submit">Aplicar</button>
        </form>
        {applied && <div className="alert ok">Cupón {applied} aplicado.</div>}
        {quote && (
          <div className="stack-sm num">
            <div className="row between"><span className="muted">Subtotal</span><span>{quote.subtotal}</span></div>
            {quote.discountCents > 0 && <div className="row between"><span className="muted">Descuento</span><span>− {quote.discount}</span></div>}
            <div className="row between"><b>Total</b><span className="price">{quote.total}</span></div>
          </div>
        )}
        {loggedIn ? (
          <button className="btn green block" type="button" disabled={paying || loading || !quote} onClick={async () => {
            setPaying(true);
            const r = await checkoutAction(lines, applied, key);
            if (r.ok) { write([]); router.push(`/cuenta/pedidos/${r.data!.orderId}?nuevo=1`); }
            else { setPaying(false); setError(r.error); }
          }}>{paying ? "Creando pedido…" : "Confirmar pedido"}</button>
        ) : (
          <Link className="btn green block" href="/ingresar?next=/carrito">Inicia sesión para comprar</Link>
        )}
        <p className="hint">Pagas con QR (Yape/Plin) y subes el comprobante. Reservamos tu producto mientras revisamos el pago.</p>
      </div>
    </div>
  );
}
