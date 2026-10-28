import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can, ROLE_LABEL, type Permission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { SideNav, type NavItem } from "@/components/side-nav";
import { logoutAction } from "@/app/(tienda)/actions";
import { getSettings } from "@/server/settings";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/admin");
  if (user.role === "CLIENTE") redirect("/cuenta");
  const [s, review, toDeliver, handoffs, tickets] = await Promise.all([
    getSettings(),
    db.payment.count({ where: { status: "EN_REVISION" } }),
    db.order.count({ where: { status: "PROCESADO" } }),
    db.conversation.count({ where: { handoff: true } }),
    db.supportTicket.count({ where: { status: "ABIERTO" } }),
  ]);
  const all: (NavItem & { perm: Permission })[] = [
    { href: "/admin", label: "Dashboard", perm: "dashboard.view", group: "Ventas" },
    { href: "/admin/pagos", label: "Aprobación de pagos", perm: "payments.review", badge: review, group: "Ventas" },
    { href: "/admin/pedidos", label: "Pedidos", perm: "orders.manage", badge: toDeliver, group: "Ventas" },
    { href: "/admin/suscripciones", label: "Suscripciones", perm: "subscriptions.manage", group: "Ventas" },
    { href: "/admin/clientes", label: "Clientes", perm: "customers.view", group: "Ventas" },
    { href: "/admin/productos", label: "Productos y planes", perm: "products.manage", group: "Catálogo" },
    { href: "/admin/licencias", label: "Códigos y licencias", perm: "licenses.manage", group: "Catálogo" },
    { href: "/admin/proveedores", label: "Proveedores", perm: "providers.manage", group: "Catálogo" },
    { href: "/admin/cupones", label: "Cupones", perm: "coupons.manage", group: "Catálogo" },
    { href: "/admin/whatsapp", label: "WhatsApp", perm: "whatsapp.manage", badge: handoffs, group: "Atención" },
    { href: "/admin/soporte", label: "Soporte", perm: "support.manage", badge: tickets, group: "Atención" },
    { href: "/admin/notificaciones", label: "Notificaciones", perm: "notifications.view", group: "Atención" },
    { href: "/admin/historial", label: "Historial", perm: "audit.view", group: "Sistema" },
    { href: "/admin/usuarios", label: "Equipo y roles", perm: "users.manage", group: "Sistema" },
    { href: "/admin/configuracion", label: "Configuración", perm: "settings.manage", group: "Sistema" },
  ];
  const items = all.filter(i => can(user.role, i.perm));
  const initials = user.name.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  return (
    <div className="shell">
      <aside className="side">
        <div className="who">
          <div className="avatar">{initials}</div>
          <b>{user.name}</b>
          <span className="role">{ROLE_LABEL[user.role]}</span>
        </div>
        <SideNav items={items} exact={["/admin"]} />
        <Link className="btn ghost sm" href="/" target="_blank">Ver tienda: {s["store.name"]}</Link>
        <form action={logoutAction}><button className="btn ghost sm block" type="submit">Cerrar sesión</button></form>
      </aside>
      <div className="content">{children}</div>
    </div>
  );
}
