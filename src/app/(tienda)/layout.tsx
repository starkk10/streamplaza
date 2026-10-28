import Link from "next/link";
import { getSettings } from "@/server/settings";
import { getCurrentUser } from "@/lib/session";
import { CartLink } from "@/components/cart";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const [s, user] = await Promise.all([getSettings(), getCurrentUser()]);
  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <Link href="/" className="brand"><span className="brand-mark">▶</span>{s["store.name"]}</Link>
          <nav className="nav" aria-label="Principal">
            <Link href="/">Tienda</Link>
            <CartLink />
            {user ? <Link href={user.role === "CLIENTE" ? "/cuenta" : "/admin"}>{user.role === "CLIENTE" ? "Mi cuenta" : "Panel"}</Link>
              : <><Link href="/ingresar">Ingresar</Link><Link href="/registro" className="btn sm">Crear cuenta</Link></>}
          </nav>
        </div>
      </header>
      <main className="wrap page">{children}</main>
      <footer className="site-footer">
        <div className="wrap row between">
          <span>© {new Date().getFullYear()} {s["store.name"]}</span>
          <span className="row">
            {s["store.supportWhatsapp"] && <span>WhatsApp: +{s["store.supportWhatsapp"].replace(/\D/g, "")}</span>}
            {s["store.supportEmail"] && <span>{s["store.supportEmail"]}</span>}
          </span>
        </div>
      </footer>
    </>
  );
}
