import { requireStaffPage } from "@/lib/session";
import { env } from "@/lib/env";
import { getSettings } from "@/server/settings";
import { emailConfigured } from "@/server/channels/email";
import { whatsappConfigured } from "@/server/channels/whatsapp";
import { ActionForm, CopyButton, SubmitButton } from "@/components/forms";
import { saveSettingsAction } from "../actions";

export const metadata = { title: "Configuración" };

export default async function SettingsPage() {
  await requireStaffPage("settings.manage");
  const s = await getSettings();
  const webhook = `${env.appUrl}/api/whatsapp/webhook`;
  const status = (ok: boolean) => <span className={`pill ${ok ? "ok" : "warn"}`}>{ok ? "Conectado" : "Sin configurar"}</span>;
  return (
    <>
      <h1>Configuración</h1>
      <ActionForm action={saveSettingsAction} className="stack">
        <div className="grid-2">
          <div className="card">
            <h2>Tienda</h2>
            <label className="f">Nombre de la tienda<input className="in" name="store.name" defaultValue={s["store.name"]} required /></label>
            <div className="form-2">
              <label className="f">Moneda (ISO)<input className="in" name="store.currency" defaultValue={s["store.currency"]} maxLength={3} required /></label>
              <label className="f">Zona horaria<input className="in" name="store.timezone" defaultValue={s["store.timezone"]} required /></label>
            </div>
            <label className="f">WhatsApp de soporte<input className="in" name="store.supportWhatsapp" defaultValue={s["store.supportWhatsapp"]} placeholder="+51 912 345 678" /></label>
            <label className="f">Correo de soporte<input className="in" name="store.supportEmail" type="email" defaultValue={s["store.supportEmail"]} /></label>
          </div>
          <div className="card">
            <h2>Pago con QR</h2>
            {s["payment.qrFile"] ? <img className="qr" src={`/api/files/public/${s["payment.qrFile"]}`} alt="QR actual" /> : <div className="alert warn">Aún no subiste tu QR. Los clientes no podrán pagar sin él.</div>}
            <label className="f">{s["payment.qrFile"] ? "Reemplazar QR" : "Subir QR"} (PNG, JPG o WEBP)<input className="in" name="qr" type="file" accept="image/png,image/jpeg,image/webp" /></label>
            <label className="f">Titular de la cuenta<input className="in" name="payment.holder" defaultValue={s["payment.holder"]} placeholder="Nombre que ve el cliente al pagar" /></label>
            <label className="f">Instrucciones de pago<textarea className="in" name="payment.instructions" defaultValue={s["payment.instructions"]} /></label>
          </div>
        </div>
        <div className="grid-2">
          <div className="card">
            <h2>Recordatorios y bot</h2>
            <label className="f">Días de aviso antes del vencimiento<input className="in" name="reminders.days" defaultValue={s["reminders.days"]} /><span className="hint">Separados por comas. 0 = el mismo día. El worker los envía aunque nadie abra la página.</span></label>
            <label className="check"><input type="checkbox" name="bot.enabled" defaultChecked={s["bot.enabled"] === "1"} /> Bot de ventas activo en WhatsApp</label>
            <label className="f">Mensaje de bienvenida del bot<textarea className="in" name="bot.welcome" defaultValue={s["bot.welcome"]} /></label>
          </div>
          <div className="card" id="canales">
            <h2>Canales de aviso</h2>
            <div className="row between"><label className="check"><input type="checkbox" name="channels.email" defaultChecked={s["channels.email"] === "1"} /> Correo electrónico</label>{status(emailConfigured())}</div>
            <div className="row between"><label className="check"><input type="checkbox" name="channels.whatsapp" defaultChecked={s["channels.whatsapp"] === "1"} /> WhatsApp</label>{status(whatsappConfigured())}</div>
            <p className="hint">Las credenciales se guardan en el archivo .env del servidor, nunca en esta página. Correo: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM. WhatsApp: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN y, para recordatorios fuera de la ventana de 24 h, WHATSAPP_TEMPLATE_NOTICE.</p>
            <div className="stack-sm">
              <span className="hint">URL del webhook para Meta (campo «messages»):</span>
              <span className="row"><span className="code-box small">{webhook}</span><CopyButton text={webhook} /></span>
              {!webhook.startsWith("https://") && <span className="hint">Meta exige una URL pública con https. En local usa un túnel (por ejemplo cloudflared) y cambia APP_URL.</span>}
            </div>
          </div>
        </div>
        <div><SubmitButton pendingText="Guardando…">Guardar configuración</SubmitButton></div>
      </ActionForm>
    </>
  );
}
