"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, CircleCheck, CircleX, RefreshCw, Clock, AlertTriangle } from "lucide-react";
import clsx from "clsx";

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

function agoLabel(ts: string | null, now: number): { text: string; stale: boolean } {
  if (!ts) return { text: "—", stale: true };
  const sec = Math.max(0, Math.round((now - Date.parse(ts)) / 1000));
  const stale = sec * 1000 > STALE_MS;
  if (sec < 60) return { text: `${sec} с назад`, stale };
  if (sec < 3600) return { text: `${Math.round(sec / 60)} мин назад`, stale };
  return { text: `${Math.round(sec / 3600)} ч назад`, stale };
}

function fmtUptime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}с`;
  if (s < 3600) return `${Math.floor(s / 60)}м ${s % 60}с`;
  const h = Math.floor(s / 3600);
  return `${h}ч ${Math.floor((s % 3600) / 60)}м`;
}

export default function AdminCollector() {
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
    return <div className="mt-6 text-sm text-muted">Загрузка…</div>;
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
              {staleFeeds.length} из {data!.feeds.length} фид(ов) не наполняются дольше {Math.round(STALE_MS / 1000)} с
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
          Collector: {online ? "онлайн" : col?.ok ? "нет синхронизированных фидов" : "недоступен"}
        </span>
        {col?.ok && col.data && (
          <>
            <span className="text-muted">аптайм {fmtUptime(col.data.uptimeMs)}</span>
            <span className="text-muted">снимок каждые {col.data.snapshotMs} мс</span>
            <span className="text-muted">глубина ±{(col.data.depthPct * 100).toFixed(1)}%</span>
            <span className="text-muted">retention {col.data.retentionDays} дн</span>
          </>
        )}
        {!col?.ok && <span className="text-faint">{col?.error}</span>}
        {error && <span className="text-loss">ошибка опроса: {error}</span>}
        <span className="ml-auto flex items-center gap-1 text-faint text-xs">
          <RefreshCw size={12} className="animate-spin [animation-duration:3s]" /> live
        </span>
      </div>

      {/* Скорость наполнения (снимков/мин, последний час) */}
      <div className="card p-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Activity size={16} className="text-accent" /> Скорость наполнения · снимков/мин (час)
        </div>
        <Sparkbars data={chart} />
      </div>

      {/* Фиды: статус + свежесть */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 text-sm font-medium border-b border-border">Фиды (symbol × exchange)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-faint border-b border-border">
                <th className="px-5 py-2 font-medium">Фид</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 font-medium text-right">Уровни bid/ask</th>
                <th className="px-3 py-2 font-medium text-right">Ресинки</th>
                <th className="px-3 py-2 font-medium text-right">Бинов в снимке</th>
                <th className="px-3 py-2 font-medium text-right">Строк/мин</th>
                <th className="px-3 py-2 font-medium text-right">Всего строк</th>
                <th className="px-3 py-2 font-medium">Последняя запись</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data!.feeds.map((f) => {
                const key = `${f.symbol}|${f.exchange}`;
                const cf = cFeedMap.get(key);
                const fresh = agoLabel(f.last_t, now);
                const isSel = selected === key || (!selected && data!.preview?.symbol === f.symbol && data!.preview?.exchange === f.exchange);
                return (
                  <tr key={key} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                    <td className="px-5 py-2.5 font-medium whitespace-nowrap">
                      {f.symbol} <span className="text-faint">· {f.exchange}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {cf ? (
                        cf.synced ? (
                          <span className="inline-flex items-center gap-1 text-profit"><CircleCheck size={14} /> synced</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-loss"><CircleX size={14} /> desync</span>
                        )
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                      {cf ? `${cf.bidLevels ?? "—"}/${cf.askLevels ?? "—"}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{cf?.resyncCount ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{cf?.obLastBins ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{f.last_min}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{f.total.toLocaleString("ru-RU")}</td>
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
                        превью
                      </button>
                    </td>
                  </tr>
                );
              })}
              {data!.feeds.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted">
                    Нет данных в ObSnapshot. Collector ещё ничего не записал.
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
            <div className="text-sm font-medium">Live-превью снимка</div>
            {data!.preview && (
              <div className="text-xs text-faint">
                {data!.preview.symbol} · {data!.preview.exchange}
              </div>
            )}
          </div>
          {data!.preview && data!.preview.bins.length > 0 ? (
            <DepthPreview bins={data!.preview.bins} />
          ) : (
            <div className="mt-6 text-sm text-muted">Нет бинов в последнем снимке.</div>
          )}
        </div>

        {/* Остальные таблицы карты ордеров */}
        <div className="card p-5">
          <div className="text-sm font-medium">Сопутствующие потоки (за минуту)</div>
          <div className="mt-4 space-y-3">
            {data!.tableStats.map((t) => {
              const fresh = agoLabel(t.last_t, now);
              const label =
                t.tbl === "ObTrade" ? "Дельта (ObTrade)" : t.tbl === "ObFootprint" ? "Футпринт (ObFootprint)" : "Крупные ордера (ObBigTrade)";
              return (
                <div key={t.tbl} className="flex items-center justify-between text-sm">
                  <span className="text-muted">{label}</span>
                  <span className="flex items-center gap-4">
                    <span className="tabular-nums">{t.last_min} /мин</span>
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
function Sparkbars({ data }: { data: { minute: number; c: number }[] }) {
  if (data.length === 0) return <div className="mt-4 text-sm text-muted">Нет записей за последний час.</div>;
  const max = Math.max(...data.map((d) => d.c), 1);
  return (
    <div className="mt-4 flex items-end gap-px h-24">
      {data.map((d) => (
        <div
          key={d.minute}
          title={`${new Date(d.minute).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} · ${d.c}`}
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
