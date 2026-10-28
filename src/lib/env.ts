// Acceso a variables de entorno. Solo se usa en el servidor.
function read(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function requireEnv(name: string): string {
  const v = read(name);
  if (!v) throw new Error(`Falta la variable de entorno ${name}. Revisa el archivo .env (ver .env.example).`);
  return v;
}

export const env = {
  get appUrl() { return read("APP_URL").replace(/\/$/, "") || "http://localhost:3000"; },
  get uploadDir() { return read("UPLOAD_DIR") || "./storage/uploads"; },
  get cronSecret() { return read("CRON_SECRET"); },
  smtp: {
    get host() { return read("SMTP_HOST"); },
    get port() { return Number(read("SMTP_PORT") || 587); },
    get user() { return read("SMTP_USER"); },
    get password() { return read("SMTP_PASSWORD"); },
    get from() { return read("SMTP_FROM"); },
    get configured() { return !!(read("SMTP_HOST") && read("SMTP_FROM")); },
  },
  whatsapp: {
    get phoneNumberId() { return read("WHATSAPP_PHONE_NUMBER_ID"); },
    get accessToken() { return read("WHATSAPP_ACCESS_TOKEN"); },
    get appSecret() { return read("WHATSAPP_APP_SECRET"); },
    get verifyToken() { return read("WHATSAPP_VERIFY_TOKEN"); },
    get apiVersion() { return read("WHATSAPP_API_VERSION") || "v21.0"; },
    get templateNotice() { return read("WHATSAPP_TEMPLATE_NOTICE"); },
    get templateLang() { return read("WHATSAPP_TEMPLATE_LANG") || "es"; },
    get configured() { return !!(read("WHATSAPP_PHONE_NUMBER_ID") && read("WHATSAPP_ACCESS_TOKEN")); },
  },
};
