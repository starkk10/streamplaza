"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; badge?: number; group?: string };

export function SideNav({ items, exact = [] }: { items: NavItem[]; exact?: string[] }) {
  const path = usePathname();
  let lastGroup: string | undefined;
  return (
    <nav aria-label="Secciones">
      {items.map(it => {
        const active = exact.includes(it.href) ? path === it.href : path === it.href || path.startsWith(it.href + "/");
        const header = it.group && it.group !== lastGroup ? <div className="side-group">{it.group}</div> : null;
        lastGroup = it.group;
        return (
          <span key={it.href} style={{ display: "contents" }}>
            {header}
            <Link href={it.href} aria-current={active ? "page" : undefined}>
              {it.label}{!!it.badge && <span className="badge">{it.badge}</span>}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
