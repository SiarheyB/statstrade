import { prisma } from "@/lib/db";
import { Database } from "lucide-react";

export const dynamic = "force-dynamic";

type TableRow = { table: string; rows: number; bytes: number };

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export default async function AdminSystemPage() {
  // Размеры таблиц и приблизительное число строк (из статистики Postgres).
  let tables: TableRow[] = [];
  let dbSize = 0;
  let error: string | null = null;
  try {
    const rows = await prisma.$queryRaw<{ table: string; rows: bigint; bytes: bigint }[]>`
      SELECT c.relname AS "table", c.reltuples::bigint AS "rows", pg_total_relation_size(c.oid)::bigint AS "bytes"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
    `;
    tables = rows.map((r) => ({ table: r.table, rows: Number(r.rows), bytes: Number(r.bytes) }));
    dbSize = tables.reduce((s, t) => s + t.bytes, 0);
  } catch (e) {
    error = (e as Error).message;
  }

  const maxBytes = Math.max(...tables.map((t) => t.bytes), 1);

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Здоровье БД</h1>
      <p className="mt-1 text-sm text-muted flex items-center gap-2">
        <Database size={15} /> Суммарный размер таблиц: <span className="font-medium text-fg">{fmtBytes(dbSize)}</span>
      </p>

      {error && <div className="mt-6 card p-4 border-loss/30 text-sm text-loss">{error}</div>}

      <div className="mt-6 card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-faint border-b border-border">
                <th className="px-5 py-2 font-medium">Таблица</th>
                <th className="px-3 py-2 font-medium text-right">Строк (~)</th>
                <th className="px-3 py-2 font-medium text-right">Размер</th>
                <th className="px-5 py-2 font-medium w-40">Доля</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.table} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                  <td className="px-5 py-2.5 font-medium">{t.table}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                    {t.rows < 0 ? "—" : t.rows.toLocaleString("ru-RU")}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtBytes(t.bytes)}</td>
                  <td className="px-5 py-2.5">
                    <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                      <div className="h-full bg-accent/60" style={{ width: `${(t.bytes / maxBytes) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-faint">
        Число строк — приблизительное (из статистики планировщика Postgres). High-volume таблицы карты ордеров (Ob*)
        чистятся по retention в collector-сервисе.
      </p>
    </div>
  );
}
