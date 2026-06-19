"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { StatsResponse, SerializedTrade } from "@/lib/types";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd, fmtDate, fmtSymbol } from "@/lib/format";

type DayStat = { pnl: number; trades: number; wins: number };

const DAY_MS = 24 * 3600 * 1000;

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export default function CalendarPage() {
  const { t, locale } = useI18n();
  const loc = locale === "en" ? "en-US" : "ru-RU";
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<{ y: number; m: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/stats");
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Per-day aggregates (UTC date, consistent with the rest of the app).
  const days = useMemo(() => {
    const map = new Map<string, DayStat>();
    for (const tr of data?.trades ?? []) {
      const k = dayKey(tr.exitTime);
      const d = map.get(k) ?? { pnl: 0, trades: 0, wins: 0 };
      d.pnl += tr.netPnl;
      d.trades += 1;
      if (tr.result === "win") d.wins += 1;
      map.set(k, d);
    }
    return map;
  }, [data]);

  // Default the view to the month of the most recent trade.
  useEffect(() => {
    if (view || !data?.trades?.length) return;
    const last = data.trades.reduce(
      (mx, tr) => Math.max(mx, new Date(tr.exitTime).getTime()),
      0,
    );
    const d = new Date(last);
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  }, [data, view]);

  const v = view ?? { y: new Date().getUTCFullYear(), m: new Date().getUTCMonth() };

  const weekdays = useMemo(() => {
    const f = new Intl.DateTimeFormat(loc, { weekday: "short", timeZone: "UTC" });
    return [...Array(7)].map((_, i) => f.format(new Date(Date.UTC(2024, 0, 1 + i))));
  }, [loc]);

  const monthLabel = new Intl.DateTimeFormat(loc, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(v.y, v.m, 1)));

  // 6-week grid starting on Monday.
  const grid = useMemo(() => {
    const first = Date.UTC(v.y, v.m, 1);
    const offset = (new Date(first).getUTCDay() + 6) % 7; // Mon=0
    const start = first - offset * DAY_MS;
    const cells: { date: string; inMonth: boolean; stat?: DayStat }[] = [];
    for (let i = 0; i < 42; i++) {
      const ts = start + i * DAY_MS;
      const date = new Date(ts).toISOString().slice(0, 10);
      cells.push({
        date,
        inMonth: new Date(ts).getUTCMonth() === v.m,
        stat: days.get(date),
      });
    }
    return cells;
  }, [v, days]);

  // Month summary (only in-month days).
  const monthStat = useMemo(() => {
    let pnl = 0, trades = 0, wins = 0, best = 0;
    for (const c of grid) {
      if (!c.inMonth || !c.stat) continue;
      pnl += c.stat.pnl;
      trades += c.stat.trades;
      wins += c.stat.wins;
      best = Math.max(best, c.stat.pnl);
    }
    return { pnl, trades, winRate: trades ? (wins / trades) * 100 : 0, best };
  }, [grid]);

  const weeks = useMemo(() => {
    const rows: (typeof grid)[] = [];
    for (let i = 0; i < 42; i += 7) rows.push(grid.slice(i, i + 7));
    return rows;
  }, [grid]);

  function shiftMonth(delta: number) {
    setSelected(null);
    const d = new Date(Date.UTC(v.y, v.m + delta, 1));
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  }
  function goToday() {
    setSelected(null);
    const d = new Date();
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  }

  function cellColor(pnl: number | undefined): string {
    if (pnl === undefined) return "transparent";
    if (pnl === 0) return "var(--color-surface-2)";
    return pnl > 0 ? "rgba(22,199,132,0.14)" : "rgba(234,57,67,0.14)";
  }

  const selectedTrades: SerializedTrade[] =
    selected && data
      ? data.trades
          .filter((tr) => dayKey(tr.exitTime) === selected)
          .sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime())
      : [];

  return (
    <div className="px-6 py-5 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold">{t("cal.title")}</h1>
          <p className="text-sm text-muted">{t("cal.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={goToday} className="input-base py-1.5 text-sm hover:border-border-strong">
            {t("cal.today")}
          </button>
          <button onClick={() => shiftMonth(-1)} className="input-base py-1.5 px-2 hover:border-border-strong">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[10rem] text-center text-sm font-medium capitalize">{monthLabel}</span>
          <button onClick={() => shiftMonth(1)} className="input-base py-1.5 px-2 hover:border-border-strong">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Month summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Summary label={t("cal.monthPnl")} value={fmtUsd(monthStat.pnl, { sign: true })} tone={monthStat.pnl >= 0 ? "profit" : "loss"} />
        <Summary label={t("cal.monthTrades")} value={String(monthStat.trades)} />
        <Summary label={t("cal.monthWin")} value={`${monthStat.winRate.toFixed(0)}%`} />
        <Summary label={t("cal.bestDay")} value={fmtUsd(monthStat.best, { sign: true })} tone="profit" />
      </div>

      {loading ? (
        <div className="text-sm text-faint">{t("common.loading")}</div>
      ) : (
        <div className="card p-4">
          {/* weekday header */}
          <div className="grid grid-cols-[repeat(7,1fr)_3rem] gap-1.5 mb-1.5">
            {weekdays.map((w) => (
              <div key={w} className="text-center text-[11px] uppercase tracking-wide text-faint py-1 capitalize">
                {w}
              </div>
            ))}
            <div className="text-center text-[11px] uppercase tracking-wide text-faint py-1">{t("cal.week")}</div>
          </div>

          <div className="space-y-1.5">
            {weeks.map((week, wi) => {
              const weekPnl = week.reduce((s, c) => s + (c.inMonth && c.stat ? c.stat.pnl : 0), 0);
              const weekHas = week.some((c) => c.inMonth && c.stat);
              return (
                <div key={wi} className="grid grid-cols-[repeat(7,1fr)_3rem] gap-1.5">
                  {week.map((c) => {
                    const day = Number(c.date.slice(8, 10));
                    const has = !!c.stat;
                    return (
                      <button
                        key={c.date}
                        onClick={() => has && setSelected(c.date === selected ? null : c.date)}
                        disabled={!has}
                        style={{ backgroundColor: cellColor(c.stat?.pnl) }}
                        className={`min-h-[64px] rounded-lg border p-1.5 text-left transition ${
                          c.inMonth ? "border-border" : "border-transparent opacity-40"
                        } ${has ? "cursor-pointer hover:border-border-strong" : "cursor-default"} ${
                          c.date === selected ? "ring-1 ring-accent" : ""
                        }`}
                      >
                        <div className="text-[11px] text-faint">{day}</div>
                        {c.stat && (
                          <>
                            <div className={`mt-1 text-xs font-semibold tabular-nums ${c.stat.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                              {fmtUsd(c.stat.pnl, { sign: true })}
                            </div>
                            <div className="text-[10px] text-faint">
                              {c.stat.trades} · {((c.stat.wins / c.stat.trades) * 100).toFixed(0)}%
                            </div>
                          </>
                        )}
                      </button>
                    );
                  })}
                  <div className={`flex flex-col items-center justify-center rounded-lg bg-surface-2 text-[11px] font-medium tabular-nums ${
                    !weekHas ? "opacity-30" : weekPnl >= 0 ? "text-profit" : "text-loss"
                  }`}>
                    {weekHas ? fmtUsd(weekPnl, { sign: true }) : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected day detail */}
      {selected && (
        <div className="card p-5 mt-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm">{fmtDate(selected + "T00:00:00Z")}</h3>
          </div>
          {selectedTrades.length === 0 ? (
            <div className="text-sm text-faint">{t("cal.noTrades")}</div>
          ) : (
            <div className="space-y-1">
              {selectedTrades.map((tr) => (
                <div key={tr.id} className="flex items-center justify-between border-b border-border last:border-0 py-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{fmtSymbol(tr.symbol)}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${tr.side === "long" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"}`}>
                      {tr.side === "long" ? "Long" : "Short"}
                    </span>
                  </div>
                  <span className={`tabular-nums font-medium ${tr.netPnl >= 0 ? "text-profit" : "text-loss"}`}>
                    {fmtUsd(tr.netPnl, { sign: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: "profit" | "loss" }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted mb-1.5">{label}</div>
      <div className={`text-xl font-semibold tracking-tight tabular-nums ${tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : ""}`}>
        {value}
      </div>
    </div>
  );
}
