import { prisma } from "@/lib/db";
import { getServerT } from "@/lib/i18n/server";
import { Database, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

type TableRow = { table: string; rows: number; bytes: number };

// Партиционированные таблицы карты ордеров: их чистит не приложение, а
// коллектор (раз в час дропает дневные партиции старше ретеншна). Здесь
// показываем, справляется ли он: «просрочено» больше нуля из часа в час —
// значит дропы не проходят (обычно занятая блокировка или ошибка на одной
// партиции), и надо смотреть /health коллектора или его лог.
const PARTITIONED = ["ObSnapshot", "ObTrade", "ObFootprint", "ObBigTrade"] as const;

type PartRow = {
  parent: string;
  part: string;
  upper: Date | null;
  bytes: bigint;
  retention_days: number | null;
  overdue: boolean;
};
type PartStat = {
  table: string;
  parts: number;
  oldest: Date | null;
  /** Когда самая старая партиция выйдет за ретеншн и будет удалена. */
  dropsAt: Date | null;
  overdue: number;
  overdueBytes: number;
  retentionDays: number | null;
  defaultRows: number;
};

function fmtDay(d: Date | null, nf: string): string {
  return d ? d.toLocaleDateString(nf, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export default async function AdminSystemPage() {
  const { t, locale } = await getServerT();
  const nf = locale === "ru" ? "ru-RU" : "en-US";
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

  // Статистика партиций: сколько их, самая старая и сколько просрочено.
  //
  // Просрочку считает сам Postgres: сравнивать с часами приложения нельзя —
  // партиции живут по времени БД, да и серверное «сейчас» в рендере страницы
  // делает её недетерминированной.
  let partStats: PartStat[] = [];
  try {
    const parts = await prisma.$queryRaw<PartRow[]>`
      SELECT p.relname AS parent,
             c.relname AS part,
             ((regexp_match(pg_get_expr(c.relpartbound, c.oid), 'TO \(''([^'']+)''\)'))[1])::timestamptz AS upper,
             pg_total_relation_size(c.oid)::bigint AS bytes,
             e.retention_days AS retention_days,
             (e.retention_days IS NOT NULL
              AND ((regexp_match(pg_get_expr(c.relpartbound, c.oid), 'TO \(''([^'']+)''\)'))[1])::timestamptz
                  <= NOW() - (e.retention_days || ' days')::interval) AS overdue
        FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
        JOIN pg_class p ON p.oid = i.inhparent
        LEFT JOIN "RetentionEpoch" e
               ON e.category = CASE WHEN p.relname = 'ObSnapshot' THEN 'snapshot' ELSE 'trade' END
       WHERE p.relname IN ('ObSnapshot', 'ObTrade', 'ObFootprint', 'ObBigTrade')
         AND pg_get_expr(c.relpartbound, c.oid) <> 'DEFAULT'
    `;
    partStats = PARTITIONED.map((table) => {
      const own = parts.filter((r) => r.parent === table && r.upper !== null);
      const overdue = own.filter((r) => r.overdue);
      const defRow = tables.find((x) => x.table === `${table}_default`);
      const oldest = own.reduce<Date | null>((m, r) => (!m || r.upper! < m ? r.upper! : m), null);
      const retention = own[0]?.retention_days ?? null;
      // Ради этой даты колонка и появилась: «почему июль ещё в базе» чаще
      // всего означает не поломку очистки, а ретеншн длиннее, чем помнится.
      const dropsAt = oldest && retention !== null
        ? new Date(oldest.getTime() + retention * 86_400_000)
        : null;
      return {
        table,
        parts: own.length,
        oldest,
        dropsAt,
        overdue: overdue.length,
        overdueBytes: overdue.reduce((sum, r) => sum + Number(r.bytes), 0),
        retentionDays: retention,
        defaultRows: defRow ? Math.max(0, defRow.rows) : 0,
      };
    }).filter((x) => x.parts > 0);
  } catch {
    partStats = [];
  }
  const overdueTotal = partStats.reduce((s, x) => s + x.overdue, 0);

  // «Осиротевшие» партиции — таблицы с именем партиции, не прикреплённые ни к
  // какой таблице. Блок выше их не покажет (он идёт по pg_inherits), а место
  // они занимают: именно так июльские ObFootprint/ObTrade и оставались в базе,
  // пока очистка честно отчитывалась «удалять нечего».
  let orphans = { count: 0, bytes: 0 };
  try {
    const rows = await prisma.$queryRaw<{ count: bigint; bytes: bigint }[]>`
      SELECT count(*)::bigint AS count, COALESCE(sum(pg_total_relation_size(c.oid)), 0)::bigint AS bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND c.relname ~ '^Ob(Snapshot|Trade|Footprint|BigTrade)_p[0-9]{8}$'
         AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
    `;
    orphans = { count: Number(rows[0]?.count ?? 0), bytes: Number(rows[0]?.bytes ?? 0) };
  } catch {
    orphans = { count: 0, bytes: 0 };
  }

  const maxBytes = Math.max(...tables.map((t) => t.bytes), 1);

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.system.title")}</h1>
      <p className="mt-1 text-sm text-muted flex items-center gap-2">
        <Database size={15} /> {t("admin.system.totalSize")} <span className="font-medium text-fg">{fmtBytes(dbSize)}</span>
      </p>

      {error && <div className="mt-6 card p-4 border-loss/30 text-sm text-loss">{error}</div>}

      <div className="mt-6 card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-faint border-b border-border">
                <th className="px-5 py-2 font-medium">{t("admin.system.th.table")}</th>
                <th className="px-3 py-2 font-medium text-right">{t("admin.system.th.rows")}</th>
                <th className="px-3 py-2 font-medium text-right">{t("admin.system.th.size")}</th>
                <th className="px-5 py-2 font-medium w-40">{t("admin.system.th.share")}</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((row) => (
                <tr key={row.table} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                  <td className="px-5 py-2.5 font-medium">{row.table}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                    {row.rows < 0 ? t("admin.dash") : row.rows.toLocaleString(nf)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtBytes(row.bytes)}</td>
                  <td className="px-5 py-2.5">
                    <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                      <div className="h-full bg-accent/60" style={{ width: `${(row.bytes / maxBytes) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {partStats.length > 0 && (
        <div className="mt-8 card overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <h2 className="text-sm font-medium">{t("admin.system.partitions")}</h2>
            {overdueTotal > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-loss">
                <AlertTriangle size={13} /> {t("admin.system.partitionsOverdue", { n: overdueTotal })}
              </span>
            )}
            {orphans.count > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-loss" title={t("admin.system.orphansHint")}>
                <AlertTriangle size={13} />{" "}
                {t("admin.system.partitionsOrphans", { n: orphans.count, size: fmtBytes(orphans.bytes) })}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-faint border-b border-border">
                  <th className="px-5 py-2 font-medium">{t("admin.system.th.table")}</th>
                  <th className="px-3 py-2 font-medium text-right">{t("admin.system.th.parts")}</th>
                  <th className="px-3 py-2 font-medium text-right">{t("admin.system.th.oldest")}</th>
                  <th className="px-3 py-2 font-medium text-right">{t("admin.system.th.retention")}</th>
                  <th className="px-3 py-2 font-medium text-right">{t("admin.system.th.dropsAt")}</th>
                  <th className="px-3 py-2 font-medium text-right">{t("admin.system.th.overdue")}</th>
                  <th className="px-5 py-2 font-medium text-right">{t("admin.system.th.inDefault")}</th>
                </tr>
              </thead>
              <tbody>
                {partStats.map((row) => (
                  <tr key={row.table} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-2.5 font-medium">{row.table}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{row.parts}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{fmtDay(row.oldest, nf)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                      {row.retentionDays === null ? t("admin.dash") : `${row.retentionDays} д`}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted" title={t("admin.system.dropsAtHint")}>
                      {row.overdue > 0 ? t("admin.system.dropsNow") : fmtDay(row.dropsAt, nf)}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${row.overdue > 0 ? "text-loss" : "text-muted"}`}>
                      {row.overdue > 0 ? `${row.overdue} · ${fmtBytes(row.overdueBytes)}` : "0"}
                    </td>
                    <td className={`px-5 py-2.5 text-right tabular-nums ${row.defaultRows > 0 ? "text-loss" : "text-muted"}`}>
                      {row.defaultRows > 0 ? row.defaultRows.toLocaleString(nf) : "0"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-xs text-faint">{t("admin.system.partitionsNote")}</p>
        </div>
      )}

      <p className="mt-3 text-xs text-faint">{t("admin.system.note")}</p>
    </div>
  );
}
