import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/session";
import { formatDate, formatMoney } from "@/lib/format";
import { getSettings } from "@/server/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Empty } from "@/components/table";
import { saveCouponAction, toggleCouponAction } from "../actions";

export const metadata = { title: "Cupones" };

export default async function Coupons() {
  await requireStaffPage("coupons.manage");
  const s = await getSettings();
  const coupons = await db.coupon.findMany({ orderBy: { createdAt: "desc" } });
  const now = new Date();
  return (
    <>
      <h1>Cupones y promociones</h1>
      <div className="grid-main">
        <div className="card">
          {coupons.length ? (
            <div className="table-wrap"><table><thead><tr><th>Código</th><th>Descuento</th><th>Vigencia</th><th className="r">Usos</th><th>Estado</th><th></th></tr></thead><tbody>
              {coupons.map(c => {
                const live = c.active && (!c.startsAt || c.startsAt <= now) && (!c.endsAt || c.endsAt >= now) && (c.maxUses == null || c.uses < c.maxUses);
                return (
                  <tr key={c.id}>
                    <td className="mono">{c.code}{c.description && <span className="sub">{c.description}</span>}</td>
                    <td>{c.type === "PORCENTAJE" ? `${c.value} %` : formatMoney(c.value, s["store.currency"])}{c.minTotalCents > 0 && <span className="sub">mín. {formatMoney(c.minTotalCents, s["store.currency"])}</span>}</td>
                    <td>{c.startsAt || c.endsAt ? `${formatDate(c.startsAt, s["store.timezone"])} → ${formatDate(c.endsAt, s["store.timezone"])}` : "Sin límite"}</td>
                    <td className="r">{c.uses}{c.maxUses != null ? ` / ${c.maxUses}` : ""}</td>
                    <td><span className={`pill ${live ? "ok" : "mute"}`}>{live ? "Vigente" : c.active ? "No vigente" : "Desactivado"}</span></td>
                    <td className="r"><ActionForm action={toggleCouponAction} className="row"><input type="hidden" name="id" value={c.id} /><SubmitButton className="btn ghost sm">{c.active ? "Desactivar" : "Activar"}</SubmitButton></ActionForm></td>
                  </tr>
                );
              })}
            </tbody></table></div>
          ) : <Empty title="No hay cupones">Crea uno para tus promociones.</Empty>}
        </div>
        <div className="card">
          <h2>Nuevo cupón</h2>
          <ActionForm action={saveCouponAction} className="form-2" resetOnSuccess>
            <label className="f">Código<input className="in mono" name="code" required placeholder="VERANO10" /></label>
            <label className="f">Tipo<select className="in" name="type"><option value="PORCENTAJE">Porcentaje</option><option value="MONTO">Monto fijo</option></select></label>
            <label className="f">Valor<input className="in" name="value" required inputMode="decimal" placeholder="10 o 5.00" /></label>
            <label className="f">Límite de usos<input className="in" name="maxUses" type="number" min={1} placeholder="Sin límite" /></label>
            <label className="f">Compra mínima<input className="in" name="minTotal" inputMode="decimal" placeholder="0.00" /></label>
            <label className="f">Descripción<input className="in" name="description" /></label>
            <label className="f">Desde<input className="in" name="startsAt" type="date" /></label>
            <label className="f">Hasta<input className="in" name="endsAt" type="date" /></label>
            <div className="full"><SubmitButton>Crear cupón</SubmitButton></div>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
