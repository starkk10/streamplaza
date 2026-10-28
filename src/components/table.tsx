import Link from "next/link";

export type SP = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 20;

export function param(sp: SP, key: string): string {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export function pageOf(sp: SP) {
  const page = Math.max(1, Number(param(sp, "pagina")) || 1);
  return { page, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE };
}

function href(base: string, sp: SP, patch: Record<string, string | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) { const s = Array.isArray(v) ? v[0] : v; if (s) q.set(k, s); }
  for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") q.delete(k); else q.set(k, v); }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** Barra de búsqueda y filtros por GET: el estado queda en la URL. */
export function Filters({ base, sp, placeholder = "Buscar…", selects = [] }: {
  base: string; sp: SP; placeholder?: string;
  selects?: { name: string; label: string; options: [string, string][]; allLabel?: string }[];
}) {
  return (
    <form className="toolbar" action={base} method="get">
      <label className="f">Buscar<input className="in" name="q" defaultValue={param(sp, "q")} placeholder={placeholder} /></label>
      {selects.map(s => (
        <label className="f" key={s.name}>{s.label}
          <select className="in" name={s.name} defaultValue={param(sp, s.name)}>
            <option value="">{s.allLabel ?? "Todos"}</option>
            {s.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      ))}
      {param(sp, "orden") && <input type="hidden" name="orden" value={param(sp, "orden")} />}
      <button className="btn ghost" type="submit">Filtrar</button>
      {(param(sp, "q") || selects.some(s => param(sp, s.name))) && <Link className="btn ghost" href={base}>Limpiar</Link>}
    </form>
  );
}

/** Cabecera ordenable: alterna entre campo y -campo en ?orden= */
export function SortTh({ base, sp, field, children, className }: { base: string; sp: SP; field: string; children: React.ReactNode; className?: string }) {
  const cur = param(sp, "orden");
  const next = cur === field ? `-${field}` : field;
  const mark = cur === field ? " ↑" : cur === `-${field}` ? " ↓" : "";
  return <th className={className}><Link href={href(base, sp, { orden: next, pagina: null })}>{children}{mark}</Link></th>;
}

export function sortOf<T extends string>(sp: SP, allowed: readonly T[], fallback: [T, "asc" | "desc"]): { field: T; dir: "asc" | "desc" } {
  const raw = param(sp, "orden");
  const field = raw.replace(/^-/, "") as T;
  if (allowed.includes(field)) return { field, dir: raw.startsWith("-") ? "desc" : "asc" };
  return { field: fallback[0], dir: fallback[1] };
}

export function Pager({ base, sp, total, page }: { base: string; sp: SP; total: number; page: number }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="pager">
      <span>{total} {total === 1 ? "resultado" : "resultados"} · página {page} de {pages}</span>
      <span className="row">
        {page > 1 && <Link className="btn ghost sm" href={href(base, sp, { pagina: String(page - 1) })}>← Anterior</Link>}
        {page < pages && <Link className="btn ghost sm" href={href(base, sp, { pagina: String(page + 1) })}>Siguiente →</Link>}
      </span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>;
}
