"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, CircleCheck, CircleX, RefreshCw, Clock, AlertTriangle } from "lucide-react";
import { Term } from "@/components/Term";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";

type T = (key: string, vars?: Record<string, string | number>) => string;

// Порог свежести (мс): дольше — фид считается отставшим. Совпадает с серверным
// FEED_STALE_MS (src/lib/admin.ts).
const STALE_MS = 90_000;

// Раздел «Карта ордеров» админ-панели. Опрашивает /api/admin/collector раз в
// несколько секунд и показывает: статус collector-сервиса, скорость наполнения,
// свежесть (lag) каждого фида и live-превью последнего снимка стакана.

const POLL_MS = 3000;

type FeedRow = {
  symbol: string;
  exchange: string;
  total: number;
  last_min: number;
  last_hour: number;
  last_t: string | null;
  oldest_t: string | null;
};
type SeriesRow = { exchange: string; minute: string; c: number };
type TableStat = { tbl: string; last_min: number; last_t: string | null };
type CollectorFeed = {
  feed: string;
  exchange: string;
  symbol: string;
  synced: boolean;
  binSize: number;
  resyncCount?: number;
  bidLevels?: number;
  askLevels?: number;
  obRows?: number;
  obLastBins?: number;
  lastWriteAgoMs?: number | null;
};
type CollectorMeta = {
  ok: boolean;
  error?: string;
  data?: {
    healthy: boolean;
    uptimeMs: number;
    snapshotMs: number;
    depthPct: number;
    retentionDays: number;
    feeds: CollectorFeed[];
  };
};
type PreviewBin = { price: number; bidVol: number; askVol: number };
type Payload = {
  now: string;
  feeds: FeedRow[];
  series: SeriesRow[];
  tableStats: TableStat[];
  collector: CollectorMeta;
  preview: { symbol: string; exchange: string; t: string | null; bins: PreviewBin[] } | null;
};

function agoLabel(ts: string | null, now: number, t: T): { text: string; stale: boolean } {
  if (!ts) return { text: t("admin.dash"), stale: true };
  const sec = Math.max(0, Math.round((now - Date.parse(ts)) / 1000));
  const stale = sec * 1000 > STALE_MS;
  if (sec < 60) return { text: t("admin.lag.secAgo", { n: sec }), stale };
  if (sec < 3600) return { text: t("admin.lag.minAgo", { n: Math.round(sec / 60) }), stale };
  return { text: t("admin.lag.hourAgo", { n: Math.round(sec / 3600) }), stale };
}

function fmtUptime(ms: number, t: T): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return t("admin.lag.sec", { n: s });
  if (s < 3600) return t("admin.lag.min", { n: Math.floor(s / 60) });
  return t("admin.lag.hour", { n: Math.round((s / 3600) * 10) / 10 });
}

export default function AdminCollector() {
  const { t, locale } = useI18n();
  const nf = locale === "ru" ? "ru-RU" : "en-US";
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // "symbol|exchange"
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = selected ? `?symbol=${selected.split("|")[0]}&exchange=${selected.split("|")[1]}` : "";
      const res = await fetch(`/api/admin/collector${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: Payload = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selected]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      await load();
      if (alive) timer.current = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const now = data ? Date.parse(data.now) : Date.now();
  const collectorFeeds = data?.collector.data?.feeds ?? [];
  const cFeedMap = useMemo(() => {
    const m = new Map<string, CollectorFeed>();
    for (const f of collectorFeeds) m.set(`${f.symbol}|${f.exchange}`, f);
    return m;
  }, [collectorFeeds]);

  // Серия для графика: минуты × суммарно по всем биржам (последний час).
  const chart = useMemo(() => {
    if (!data) return [] as { minute: number; c: number }[];
    const byMin = new Map<number, number>();
    for (const r of data.series) {
      const m = Date.parse(r.minute);
      byMin.set(m, (byMin.get(m) ?? 0) + r.c);
    }
    return Array.from(byMin.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([minute, c]) => ({ minute, c }));
  }, [data]);

  if (!data && !error) {
    return <div className="mt-6 text-sm text-muted">{t("admin.loading")}</div>;
  }

  const col = data?.collector;
  const online = col?.ok && col.data?.healthy;
  const staleFeeds = (data?.feeds ?? []).filter((f) => {
    const lag = f.last_t ? now - Date.parse(f.last_t) : Infinity;
    return lag > STALE_MS;
  });

  return (
    <div className="mt-6 space-y-6">
      {/* Сводный алерт: фиды, переставшие наполняться. */}
      {staleFeeds.length > 0 && (
        <div className="card p-4 border-loss/40 flex items-start gap-3 text-sm">
          <AlertTriangle size={18} className="text-loss shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-loss">
              {t("admin.collector.staleBanner", {
                n: staleFeeds.length,
                total: data!.feeds.length,
                sec: Math.round(STALE_MS / 1000),
              })}
            </div>
            <div className="mt-1 text-muted">
              {staleFeeds.map((f) => `${f.symbol}·${f.exchange}`).join(", ")}
            </div>
          </div>
        </div>
      )}
      {/* Статус collector-сервиса */}
      <div
        className={clsx(
          "card p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm",
          online ? "border-profit/30" : "border-loss/30",
        )}
      >
        <span className="flex items-center gap-2 font-medium">
          {online ? (
            <CircleCheck size={18} className="text-profit" />
          ) : (
            <CircleX size={18} className="text-loss" />
          )}
          {t("admin.collector.status")}{" "}
          {online
            ? t("admin.collector.online")
            : col?.ok
              ? t("admin.collector.noSynced")
              : t("admin.collector.unavailable")}
        </span>
        {col?.ok && col.data && (
          <>
            <span className="text-muted">{t("admin.collector.uptime", { v: fmtUptime(col.data.uptimeMs, t) })}</span>
            <span className="text-muted">{t("admin.collector.snapshotEvery", { ms: col.data.snapshotMs })}</span>
            <span className="text-muted">{t("admin.collector.depth", { pct: (col.data.depthPct * 100).toFixed(1) })}</span>
            <span className="text-muted">{t("admin.collector.retention", { days: col.data.retentionDays })}</span>
          </>
        )}
        {!col?.ok && <span className="text-faint">{col?.error}</span>}
        {error && <span className="text-loss">{t("admin.collector.pollError", { e: error })}</span>}
        <span className="ml-auto flex items-center gap-1 text-faint text-xs">
          <RefreshCw size={12} className="animate-spin [animation-duration:3s]" /> {t("admin.collector.live")}
        </span>
      </div>

      {/* Скорость наполнения (снимков/мин, последний час) */}
      <div className="card p-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Activity size={16} className="text-accent" /> {t("admin.collector.fillRate")}
        </div>
        <Sparkbars data={chart} t={t} nf={nf} />
      </div>

      {/* Фиды: статус + свежесть */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 text-sm font-medium border-b border-border">{t("admin.collector.feeds")}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-faint border-b border-border">
                <th className="px-5 py-2 font-medium"><Term desc={t("admin.collector.th.feed.desc")}>{t("admin.collector.th.feed")}</Term></th>
                <th className="px-3 py-2 font-medium"><Term desc={t("admin.collector.th.status.desc")}>{t("admin.collector.th.status")}</Term></th>
                <th className="px-3 py-2 font-medium text-right"><Term desc={t("admin.collector.th.levels.desc")}>{t("admin.collector.th.levels")}</Term></th>
                <th className="px-3 py-2 font-medium text-right"><Term desc={t("admin.collector.th.resyncs.desc")}>{t("admin.collector.th.resyncs")}</Term></th>
                <th className="px-3 py-2 font-medium text-right"><Term desc={t("admin.collector.th.bins.desc")}>{t("admin.collector.th.bins")}</Term></th>
                <th className="px-3 py-2 font-medium text-right"><Term desc={t("admin.collector.th.rowsMin.desc")}>{t("admin.collector.th.rowsMin")}</Term></th>
                <th className="px-3 py-2 font-medium text-right"><Term desc={t("admin.collector.th.total.desc")}>{t("admin.collector.th.total")}</Term></th>
                <th className="px-3 py-2 font-medium"><Term desc={t("admin.collector.th.lastWrite.desc")}>{t("admin.collector.th.lastWrite")}</Term></th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data!.feeds.map((f) => {
                const key = `${f.symbol}|${f.exchange}`;
                const cf = cFeedMap.get(key);
                const fresh = agoLabel(f.last_t, now, t);
                const isSel = selected === key || (!selected && data!.preview?.symbol === f.symbol && data!.preview?.exchange === f.exchange);
                return (
                  <tr key={key} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                    <td className="px-5 py-2.5 font-medium whitespace-nowrap">
                      {f.symbol} <span className="text-faint">· {f.exchange}</span>
                    </td>
                    <td className="px-3 py-2.5" title={cf ? (cf.synced ? t("admin.collector.th.status.desc") : t("admin.collector.th.status.desc")) : t("admin.collector.th.status.desc")}>
                      {cf ? (
                        cf.synced ? (
                          <span className="inline-flex items-center gap-1 text-profit"><CircleCheck size={14} /> {t("admin.collector.synced")}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-loss"><CircleX size={14} /> {t("admin.collector.desync")}</span>
                        )
                      ) : (
                        <span className="text-faint">{t("admin.dash")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                      {cf ? `${cf.bidLevels ?? "—"}/${cf.askLevels ?? "—"}` : t("admin.dash")}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{cf?.resyncCount ?? t("admin.dash")}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{cf?.obLastBins ?? t("admin.dash")}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{f.last_min}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{f.total.toLocaleString(nf)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={clsx("inline-flex items-center gap-1", fresh.stale ? "text-loss" : "text-muted")}>
                        <Clock size={13} /> {fresh.text}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <button
                        onClick={() => setSelected(key)}
                        className={clsx(
                          "text-xs px-2 py-1 rounded-md transition",
                          isSel ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2",
                        )}
                      >
                        {t("admin.collector.preview")}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {data!.feeds.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted">
                    {t("admin.collector.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Live-превью последнего снимка стакана */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">{t("admin.collector.previewTitle")}</div>
            {data!.preview && (
              <div className="text-xs text-faint">
                {data!.preview.symbol} · {data!.preview.exchange}
              </div>
            )}
          </div>
          {data!.preview && data!.preview.bins.length > 0 ? (
            <DepthPreview bins={data!.preview.bins} />
          ) : (
            <div className="mt-6 text-sm text-muted">{t("admin.collector.previewEmpty")}</div>
          )}
        </div>

        {/* Остальные таблицы карты ордеров */}
        <div className="card p-5">
          <div className="text-sm font-medium">{t("admin.collector.related")}</div>
          <div className="mt-4 space-y-3">
            {data!.tableStats.map((ts) => {
              const fresh = agoLabel(ts.last_t, now, t);
              const label =
                ts.tbl === "ObTrade"
                  ? t("admin.collector.delta")
                  : ts.tbl === "ObFootprint"
                    ? t("admin.collector.footprint")
                    : t("admin.collector.big");
              return (
                <div key={ts.tbl} className="flex items-center justify-between text-sm">
                  <span className="text-muted">{label}</span>
                  <span className="flex items-center gap-4">
                    <span className="tabular-nums">
                      {ts.last_min} {t("admin.collector.perMin")}
                    </span>
                    <span className={clsx("text-xs flex items-center gap-1", fresh.stale ? "text-loss" : "text-faint")}>
                      <Clock size={12} /> {fresh.text}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Простой бар-график без зависимостей.
function Sparkbars({ data, t, nf }: { data: { minute: number; c: number }[]; t: T; nf: string }) {
  if (data.length === 0) return <div className="mt-4 text-sm text-muted">{t("admin.collector.noHour")}</div>;
  const max = Math.max(...data.map((d) => d.c), 1);
  return (
    <div className="mt-4 flex items-end gap-px h-24">
      {data.map((d) => (
        <div
          key={d.minute}
          title={`${new Date(d.minute).toLocaleTimeString(nf, { hour: "2-digit", minute: "2-digit" })} · ${d.c}`}
          className="flex-1 min-w-px bg-accent/60 rounded-t-sm"
          style={{ height: `${Math.max(2, (d.c / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

// Вертикальная полоса глубины: для каждого ценового бина — bid (зелёный) слева
// и ask (красный) справа от центра, длина пропорциональна объёму.
function DepthPreview({ bins }: { bins: PreviewBin[] }) {
  const sorted = [...bins].sort((a, b) => b.price - a.price);
  const max = Math.max(...bins.map((b) => Math.max(b.bidVol, b.askVol)), 1);
  return (
    <div className="mt-4 space-y-px max-h-80 overflow-y-auto pr-1">
      {sorted.map((b) => (
        <div key={b.price} className="flex items-center gap-2 text-[11px] tabular-nums">
          <div className="flex-1 flex justify-end">
            <div
              className="h-3 rounded-l-sm bg-profit/70"
              style={{ width: `${(b.bidVol / max) * 100}%` }}
              title={`bid ${b.bidVol}`}
            />
          </div>
          <span className="w-20 text-center text-faint">{b.price}</span>
          <div className="flex-1">
            <div
              className="h-3 rounded-r-sm bg-loss/70"
              style={{ width: `${(b.askVol / max) * 100}%` }}
              title={`ask ${b.askVol}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
