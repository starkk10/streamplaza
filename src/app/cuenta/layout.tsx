import Link from "next/link";
import { requireUser } from "@/lib/session";
import { SideNav } from "@/components/side-nav";
import { logoutAction } from "@/app/(tienda)/actions";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/cuenta");
  const pending = await db.order.count({ where: { customerId: user.id, status: "PENDIENTE" } });
  const initials = user.name.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  return (
    <div className="shell">
      <aside className="side">
        <div className="who">
          <div className="avatar">{initials}</div>
          <b>{user.name}</b>
          <span className="role">Cliente</span>
        </div>
        <SideNav exact={["/cuenta"]} items={[
          { href: "/cuenta", label: "Resumen" },
          { href: "/cuenta/suscripciones", label: "Mis suscripciones" },
          { href: "/cuenta/pedidos", label: "Mis pedidos", badge: pending },
          { href: "/cuenta/pagos", label: "Pagos" },
          { href: "/cuenta/soporte", label: "Soporte" },
          { href: "/cuenta/perfil", label: "Mi perfil" },
          { href: "/", label: "Ir a la tienda" },
        ]} />
        {user.role !== "CLIENTE" && <Link className="btn ghost sm" href="/admin">Ir al panel</Link>}
        <form action={logoutAction}><button className="btn ghost sm block" type="submit">Cerrar sesión</button></form>
      </aside>
      <div className="content">{children}</div>
    </div>
  );
}
