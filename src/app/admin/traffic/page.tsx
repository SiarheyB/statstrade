import Link from "next/link";
import { Activity, Bot, Users, Eye, LogIn, Timer, MousePointerClick } from "lucide-react";
import { getServerT, getTimezone } from "@/lib/i18n/server";
import { offsetMinutes } from "@/lib/timezone";
import { getTrafficReport } from "@/lib/traffic/report";
import { isPeriod, PERIODS, type PeriodKey } from "@/lib/traffic/periods";
import type { Audience } from "@/lib/traffic/query";
import { retentionDays } from "@/lib/traffic/ingest";
import TrafficLive from "@/components/admin/TrafficLive";

export const dynamic = "force-dynamic";

const AUDIENCES: Audience[] = ["human", "bot", "all"];

type Search = { [k: string]: string | string[] | undefined };

export default async function AdminTrafficPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { t, locale } = await getServerT();
  const sp = await searchParams;
  const nf = locale === "ru" ? "ru-RU" : "en-US";
  const num = (n: number) => n.toLocaleString(nf);
  const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;

  const period: PeriodKey = isPeriod(strParam(sp.p)) ? (strParam(sp.p) as PeriodKey) : "7d";
  const audience: Audience = AUDIENCES.includes(strParam(sp.a) as Audience)
    ? (strParam(sp.a) as Audience)
    : "human";

  // Сутки режем по таймзоне админа, а не по UTC (см. lib/traffic/periods.ts).
  const tz = await getTimezone();
  const tzOffsetMin = offsetMinutes(tz) ?? 0;
  const r = await getTrafficReport(period, tzOffsetMin, audience);

  // «Сейчас» берём из отчёта (range.to), а не из Date.now(): рендер серверного
  // компонента должен быть чистым — иначе react-hooks/purity ругается, и по делу.
  const nowMs = Date.parse(r.range.to);
  const collecting = r.live.lastHitAt ? nowMs - Date.parse(r.live.lastHitAt) < 24 * 3600_000 : false;
  const maxViews = Math.max(1, ...r.series.map((s) => s.humanViews + s.botViews));
  const botShare = r.totals.views ? r.totals.botViews / r.totals.views : 0;

  const href = (p: PeriodKey, a: Audience) => `/admin/traffic?p=${p}&a=${a}`;
  const bucketLabel = (iso: string) => {
    // Значения уже сдвинуты в зону админа на стороне SQL — берём UTC-части,
    // иначе сдвиг применился бы дважды (см. CLAUDE.md, раздел про таймзону).
    const d = new Date(iso);
    return r.range.bucket === "hour"
      ? `${String(d.getUTCHours()).padStart(2, "0")}:00`
      : `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const time = (iso: string) =>
    new Date(new Date(iso).getTime() + tzOffsetMin * 60_000).toISOString().slice(5, 16).replace("T", " ");

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.traffic.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("admin.traffic.subtitle")}</p>

      {/* Контроль самого сбора: если он отвалился (упал приёмник, выключили
          переменной окружения), пустой график легко принять за «нет людей». */}
      {!collecting && (
        <div className="mt-6 card p-4 text-sm border-accent/40">
          {r.live.lastHitAt
            ? t("admin.traffic.staleCollector", { at: time(r.live.lastHitAt) })
            : t("admin.traffic.noData")}
        </div>
      )}

      {/* Фильтры: период и аудитория. Обычные ссылки — состояние живёт в URL,
          его можно сохранить в закладки и переслать. */}
      <div className="mt-6 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={href(p, audience)}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${
              p === period ? "bg-accent/15 text-accent" : "text-muted hover:text-fg hover:bg-surface-2"
            }`}
          >
            {t(`admin.traffic.period.${p}`)}
          </Link>
        ))}
        <span className="w-px bg-border mx-1" />
        {AUDIENCES.map((a) => (
          <Link
            key={a}
            href={href(period, a)}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${
              a === audience ? "bg-accent/15 text-accent" : "text-muted hover:text-fg hover:bg-surface-2"
            }`}
          >
            {t(`admin.traffic.audience.${a}`)}
          </Link>
        ))}
      </div>

      <TrafficLive initial={r.live} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Users size={16} />} label={t("admin.traffic.kpi.visitors")} value={num(r.totals.humanVisitors)}
          delta={r.deltas.visitors} hint={t("admin.traffic.kpi.visitorsHint", { n: num(r.sessions.newVisitors) })} />
        <Stat icon={<MousePointerClick size={16} />} label={t("admin.traffic.kpi.sessions")} value={num(r.sessions.sessions)}
          delta={r.deltas.sessions} hint={t("admin.traffic.kpi.sessionsHint", { n: pct(r.sessions.bounceRate) })} />
        <Stat icon={<Eye size={16} />} label={t("admin.traffic.kpi.views")} value={num(r.totals.humanViews)}
          delta={r.deltas.views} hint={t("admin.traffic.kpi.viewsHint", { n: r.sessions.viewsPerSession.toFixed(1) })} />
        <Stat icon={<Timer size={16} />} label={t("admin.traffic.kpi.duration")} value={mmss(r.sessions.avgDurationSec)}
          hint={t("admin.traffic.kpi.durationHint")} />
        <Stat icon={<LogIn size={16} />} label={t("admin.traffic.kpi.registered")} value={num(r.sessions.registered)}
          hint={t("admin.traffic.kpi.registeredHint", {
            n: r.sessions.sessions ? pct(r.sessions.registered / r.sessions.sessions) : "0%",
          })} />
        <Stat icon={<LogIn size={16} />} label={t("admin.traffic.kpi.loggedIn")} value={num(r.sessions.loggedIn)}
          hint={t("admin.traffic.kpi.loggedInHint")} />
        <Stat icon={<Bot size={16} />} label={t("admin.traffic.kpi.bots")} value={pct(botShare)}
          hint={t("admin.traffic.kpi.botsHint", { views: num(r.totals.botViews), sessions: num(r.totals.botSessions) })} />
        <Stat icon={<Activity size={16} />} label={t("admin.traffic.kpi.jsConfirmed")} value={num(r.sessions.jsConfirmed)}
          hint={t("admin.traffic.kpi.jsConfirmedHint")} />
      </div>

      {/* График: люди снизу, роботы сверху той же колонкой — сразу видно, из
          чего состоит «посещаемость». Своя вёрстка, а не библиотека графиков:
          столбики не нуждаются в клиентском JS. */}
      <div className="mt-6 card p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-faint">{t("admin.traffic.chart.title")}</div>
          <div className="flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-accent inline-block" />{t("admin.traffic.chart.people")}</span>
            <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-muted/40 inline-block" />{t("admin.traffic.chart.bots")}</span>
          </div>
        </div>
        <div className="mt-4 flex items-end gap-[3px] h-48">
          {r.series.length === 0 && <div className="text-sm text-muted self-center">{t("admin.traffic.empty")}</div>}
          {r.series.map((s) => {
            const total = s.humanViews + s.botViews;
            return (
              <div key={s.bucket} className="flex-1 min-w-0 h-full flex flex-col justify-end group" title={
                `${bucketLabel(s.bucket)} · ${t("admin.traffic.chart.people")}: ${num(s.humanViews)} · ${t("admin.traffic.chart.visitorsShort")}: ${num(s.humanVisitors)} · ${t("admin.traffic.chart.bots")}: ${num(s.botViews)}`
              }>
                <div className="w-full bg-muted/30 rounded-t-sm" style={{ height: `${(s.botViews / maxViews) * 100}%` }} />
                <div className="w-full bg-accent/80 group-hover:bg-accent transition-colors" style={{ height: `${(s.humanViews / maxViews) * 100}%` }} />
                <div className="mt-1 text-[9px] text-faint text-center truncate">{total ? bucketLabel(s.bucket) : ""}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title={t("admin.traffic.pages.title")} hint={t("admin.traffic.pages.hint")}>
          <Table
            head={[t("admin.traffic.th.page"), t("admin.traffic.th.views"), t("admin.traffic.th.visitors"), t("admin.traffic.th.entries"), t("admin.traffic.th.bounce")]}
            rows={r.pages.map((p) => [p.path, num(p.views), num(p.visitors), num(p.entries), p.entries ? pct(p.bounceRate) : "—"])}
            empty={t("admin.traffic.empty")}
          />
        </Card>

        <Card title={t("admin.traffic.sources.title")} hint={t("admin.traffic.sources.hint")}>
          <Table
            head={[t("admin.traffic.th.source"), t("admin.traffic.th.sessions"), t("admin.traffic.th.visitors"), t("admin.traffic.th.bounce"), t("admin.traffic.th.registered")]}
            rows={r.sources.map((s) => [
              `${t(`admin.traffic.source.${s.source}`)}${s.refHost ? ` · ${s.refHost}` : ""}`,
              num(s.sessions), num(s.visitors), pct(s.bounceRate), num(s.registered),
            ])}
            empty={t("admin.traffic.empty")}
          />
        </Card>
      </div>

      {r.campaigns.length > 0 && (
        <div className="mt-6">
          <Card title={t("admin.traffic.campaigns.title")} hint={t("admin.traffic.campaigns.hint")}>
            <Table
              head={["utm_source", "utm_medium", "utm_campaign", t("admin.traffic.th.sessions"), t("admin.traffic.th.registered")]}
              rows={r.campaigns.map((c) => [c.utmSource, c.utmMedium ?? "—", c.utmCampaign ?? "—", num(c.sessions), num(c.registered)])}
              empty={t("admin.traffic.empty")}
            />
          </Card>
        </div>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <Card title={t("admin.traffic.devices")}><Bars rows={r.devices} fmt={num} pct={pct} empty={t("admin.traffic.empty")} /></Card>
        <Card title={t("admin.traffic.browsers")}><Bars rows={r.browsers} fmt={num} pct={pct} empty={t("admin.traffic.empty")} /></Card>
        <Card title={t("admin.traffic.os")}><Bars rows={r.systems} fmt={num} pct={pct} empty={t("admin.traffic.empty")} /></Card>
        <Card title={t("admin.traffic.langs")}><Bars rows={r.langs} fmt={num} pct={pct} empty={t("admin.traffic.empty")} /></Card>
        {/* Страна известна, только если перед приложением стоит прокси, который
            её проставляет (Cloudflare) — иначе карточку не показываем вовсе. */}
        {r.countries.some((c) => c.key !== "\u2014") && (
          <Card title={t("admin.traffic.countries")}><Bars rows={r.countries} fmt={num} pct={pct} empty={t("admin.traffic.empty")} /></Card>
        )}
      </div>

      <div className="mt-6">
        <Card title={t("admin.traffic.bots.title")} hint={t("admin.traffic.bots.hint")}>
          <Table
            head={[t("admin.traffic.th.bot"), t("admin.traffic.th.category"), t("admin.traffic.th.views"), t("admin.traffic.th.sessions"), t("admin.traffic.th.lastSeen"), t("admin.traffic.th.lastPath")]}
            rows={r.bots.map((b) => [
              b.name,
              b.category ? t(`admin.traffic.botCat.${b.category}`) : "—",
              num(b.views), num(b.sessions), time(b.lastSeen), b.topPath ?? "—",
            ])}
            empty={t("admin.traffic.emptyBots")}
          />
        </Card>
      </div>

      <div className="mt-6">
        <Card title={t("admin.traffic.visits.title")} hint={t("admin.traffic.visits.hint")}>
          <Table
            head={[t("admin.traffic.th.time"), t("admin.traffic.th.who"), t("admin.traffic.th.source"), t("admin.traffic.th.entry"), t("admin.traffic.th.exit"), t("admin.traffic.th.views"), t("admin.traffic.th.device")]}
            rows={r.visits.map((v) => [
              time(v.startedAt),
              v.isBot
                ? `🤖 ${v.botName ?? t("admin.traffic.bot")}`
                : `${v.jsConfirmed ? "🧑" : "❓"} ${v.registered ? t("admin.traffic.registeredMark") : v.authed ? t("admin.traffic.authedMark") : t("admin.traffic.guestMark")}`,
              `${t(`admin.traffic.source.${v.source}`)}${v.refHost ? ` · ${v.refHost}` : ""}`,
              v.entryPath,
              v.exitPath,
              num(v.views),
              [v.device, v.browser, v.os].filter(Boolean).join(" · "),
            ])}
            empty={t("admin.traffic.empty")}
          />
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted">
        {t("admin.traffic.footnote", { days: retentionDays() })}
      </p>
    </div>
  );
}

function strParam(v: string | string[] | undefined): string | null {
  return typeof v === "string" ? v : null;
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Stat({ icon, label, value, hint, delta }: {
  icon: React.ReactNode; label: string; value: string; hint?: string; delta?: number | null;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight">{value}</span>
        {delta !== undefined && delta !== null && delta !== 0 && (
          <span className={`text-xs mb-1 ${delta > 0 ? "text-profit" : "text-loss"}`}>
            {delta > 0 ? "+" : ""}{(delta * 100).toFixed(0)}%
          </span>
        )}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-wide text-faint">{title}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: (string | number)[][]; empty: string }) {
  if (rows.length === 0) return <div className="py-6 text-center text-sm text-muted">{empty}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-faint border-b border-border">
            {head.map((h, i) => (
              <th key={h + i} className={`py-2 font-medium ${i === 0 ? "" : "text-right"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
              {row.map((cell, j) => (
                <td key={j} className={`py-2 ${j === 0 ? "pr-3 max-w-[22rem] truncate" : "text-right tabular-nums whitespace-nowrap pl-3"} ${j === 0 ? "" : "text-muted"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bars({ rows, fmt, pct, empty }: {
  rows: { key: string; sessions: number; share: number }[];
  fmt: (n: number) => string;
  pct: (n: number) => string;
  empty: string;
}) {
  if (rows.length === 0) return <div className="py-6 text-center text-sm text-muted">{empty}</div>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="flex justify-between text-xs">
            <span className="truncate">{r.key}</span>
            <span className="text-muted tabular-nums">{fmt(r.sessions)} · {pct(r.share)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-accent/70" style={{ width: `${Math.max(2, r.share * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
