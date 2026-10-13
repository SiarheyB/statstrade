import Link from "next/link";
import { Download, Users, Repeat, CalendarDays } from "lucide-react";
import { prisma } from "@/lib/db";
import { BUNDLED_LABEL } from "@/lib/advisorFile";
import AdvisorUpload from "@/components/admin/AdvisorUpload";
import { getServerT, getTimezone } from "@/lib/i18n/server";
import { offsetMinutes } from "@/lib/timezone";

export const dynamic = "force-dynamic";

const PERIODS = { "7d": 7, "30d": 30, all: 0 } as const;
type PeriodKey = keyof typeof PERIODS;
const LIST_LIMIT = 200;

type Search = { [k: string]: string | string[] | undefined };

export default async function AdminAdvisorPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { t } = await getServerT();
  const sp = await searchParams;
  const raw = Array.isArray(sp.p) ? sp.p[0] : sp.p;
  const period: PeriodKey = raw && raw in PERIODS ? (raw as PeriodKey) : "30d";

  const tzOffsetMin = offsetMinutes(await getTimezone()) ?? 0;
  // Серверный компонент: рендер на каждый запрос, гидратации нет.
  /* eslint-disable-next-line react-hooks/purity */
  const nowMs = Date.now();
  const since = PERIODS[period] ? new Date(nowMs - PERIODS[period] * 86400_000) : undefined;

  const current = await prisma.advisorFile.findUnique({ where: { id: "current" }, select: { label: true } });
  const rows = await prisma.advisorDownload.findMany({
    where: since ? { ts: { gte: since } } : undefined,
    orderBy: { ts: "desc" },
    take: 5000,
  });

  const users = new Set(rows.map((r) => r.userId ?? r.email));
  const repeats = rows.filter((r) => r.isRepeat).length;
  const dayKey = (d: Date) => new Date(d.getTime() + tzOffsetMin * 60_000).toISOString().slice(0, 10);
  const today = dayKey(new Date(nowMs));
  const todayCount = rows.filter((r) => dayKey(r.ts) === today).length;

  const tally = (pick: (r: (typeof rows)[number]) => string | null) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = pick(r) ?? "—";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  };

  // Ряд по дням: последние 14 суток (или меньше, если период короче).
  const span = Math.min(14, PERIODS[period] || 14);
  const series: { day: string; n: number }[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const day = dayKey(new Date(nowMs - i * 86400_000));
    series.push({ day, n: rows.filter((r) => dayKey(r.ts) === day).length });
  }
  const maxN = Math.max(1, ...series.map((s) => s.n));
  const time = (d: Date) =>
    new Date(d.getTime() + tzOffsetMin * 60_000).toISOString().slice(0, 16).replace("T", " ");
  const kb = (b: number) => `${Math.round(b / 1024)} KB`;

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.advisor.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("admin.advisor.subtitle")}</p>

      <AdvisorUpload currentLabel={current?.label ?? BUNDLED_LABEL} uploaded={!!current} />

      <div className="mt-6 flex flex-wrap gap-2">
        {(Object.keys(PERIODS) as PeriodKey[]).map((p) => (
          <Link
            key={p}
            href={`/admin/advisor?p=${p}`}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${
              p === period ? "bg-accent/15 text-accent" : "text-muted hover:text-fg hover:bg-surface-2"
            }`}
          >
            {t(`admin.advisor.period.${p}`)}
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<Download size={16} />} label={t("admin.advisor.kpi.total")} value={rows.length} />
        <Kpi icon={<Users size={16} />} label={t("admin.advisor.kpi.users")} value={users.size} />
        <Kpi icon={<Repeat size={16} />} label={t("admin.advisor.kpi.repeat")} value={repeats} />
        <Kpi icon={<CalendarDays size={16} />} label={t("admin.advisor.kpi.today")} value={todayCount} />
      </div>

      <div className="mt-6 card p-4">
        <div className="text-sm font-medium mb-3">{t("admin.advisor.byDay")}</div>
        <div className="flex items-end gap-1.5 h-28">
          {series.map((s) => (
            <div key={s.day} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={`${s.day}: ${s.n}`}>
              <span className="text-[10px] text-muted">{s.n || ""}</span>
              <div className="w-full rounded-t bg-accent/60" style={{ height: `${(s.n / maxN) * 100}%`, minHeight: s.n ? 4 : 1 }} />
              <span className="text-[10px] text-muted">{s.day.slice(8)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Breakdown title={t("admin.advisor.device")} items={tally((r) => r.device)} />
        <Breakdown title={t("admin.advisor.os")} items={tally((r) => r.os)} />
        <Breakdown title={t("admin.advisor.browser")} items={tally((r) => r.browser)} />
        <Breakdown title={t("admin.advisor.country")} items={tally((r) => r.country)} />
      </div>

      <div className="mt-6 card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="p-3 font-normal">{t("admin.advisor.col.when")}</th>
              <th className="p-3 font-normal">{t("admin.advisor.col.who")}</th>
              <th className="p-3 font-normal">{t("admin.advisor.col.how")}</th>
              <th className="p-3 font-normal">{t("admin.advisor.col.from")}</th>
              <th className="p-3 font-normal">{t("admin.advisor.col.file")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, LIST_LIMIT).map((r) => (
              <tr key={r.id} className="border-b border-border/50 last:border-0">
                <td className="p-3 whitespace-nowrap">{time(r.ts)}</td>
                <td className="p-3">
                  {r.userId ? (
                    <Link href={`/admin/users/${r.userId}`} className="hover:text-accent">{r.email}</Link>
                  ) : (
                    r.email
                  )}
                  {r.isRepeat && <span className="ml-2 text-xs text-muted">{t("admin.advisor.again")}</span>}
                </td>
                <td className="p-3 text-muted">
                  {[r.device, r.os, r.browser].filter(Boolean).join(" · ")}
                  {r.country ? ` · ${r.country}` : ""}
                </td>
                <td className="p-3 text-muted">{r.referrer ?? "—"}</td>
                <td className="p-3 text-muted whitespace-nowrap">
                  {kb(r.bytes)}
                  {r.version ? ` · v${/^\d{4}-/.test(r.version) ? time(new Date(r.version)) : r.version}` : ""}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-muted">{t("admin.advisor.empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > LIST_LIMIT && (
        <p className="mt-2 text-xs text-muted">{t("admin.advisor.limited", { n: LIST_LIMIT })}</p>
      )}
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-sm text-muted">{icon}{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value.toLocaleString("ru-RU")}</div>
    </div>
  );
}

function Breakdown({ title, items }: { title: string; items: [string, number][] }) {
  return (
    <div className="card p-4">
      <div className="text-sm font-medium mb-2">{title}</div>
      <ul className="space-y-1 text-sm">
        {items.map(([k, n]) => (
          <li key={k} className="flex justify-between"><span className="text-muted">{k}</span><span>{n}</span></li>
        ))}
        {items.length === 0 && <li className="text-muted">—</li>}
      </ul>
    </div>
  );
}
