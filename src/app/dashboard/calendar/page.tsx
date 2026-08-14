"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { SerializedTrade } from "@/lib/types";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd, fmtDate, fmtSymbol } from "@/lib/format";
import { zonedParts, zonedDateToUtcMs, tzOffsetForServer, type TimezoneId } from "@/lib/timezone";

// Дневной агрегат в том виде, в каком его отдаёт /api/calendar.
type DayStat = {
  date: string;
  netPnl: number;
  trades: number;
  wins: number;
  losses: number;
  winR: number;
  lossR: number;
  rTrades: number;
};

type AccountOption = { id: string; label: string; exchange: string };

const DAY_MS = 24 * 3600 * 1000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Границы сетки (6 недель с понедельника) как UTC-инстанты: сервер фильтрует
// почасовые агрегаты именно по ним.
function gridRange(y: number, m: number, tz: TimezoneId): { start: number; end: number } {
  const first = zonedDateToUtcMs(y, m, 1, tz);
  const offset = (zonedParts(first, tz).day + 6) % 7; // Mon=0
  const start = first - offset * DAY_MS;
  return { start, end: start + 42 * DAY_MS };
}

export default function CalendarPage() {
  const { t, locale, timezone } = useI18n();
  const loc = locale === "en" ? "en-US" : "ru-RU";
  const [days, setDays] = useState<Map<string, DayStat>>(new Map());
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<{ y: number; m: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedTrades, setSelectedTrades] = useState<SerializedTrade[]>([]);
  const [accountId, setAccountId] = useState("all");
  // На первое открытие прыгаем в месяц последней сделки — но только один раз,
  // иначе перелистывание месяцев отбрасывало бы пользователя назад.
  const jumped = useRef(false);

  // Текущий месяц фиксируется ОДИН РАЗ при монтировании, а не считается во
  // время рендера: Date.now() в рендере — нечистый вызов (react-hooks/purity),
  // и результат всё равно не обновлялся бы сам при пересечении полуночи.
  const [today] = useState(() => Date.now());
  const defaultView = useMemo(() => {
    const zp = zonedParts(today, timezone);
    return { y: zp.y, m: zp.mo };
  }, [today, timezone]);
  const v = view ?? defaultView;

  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = gridRange(v.y, v.m, timezone);
    const params = new URLSearchParams({
      accountId,
      from: new Date(start).toISOString(),
      to: new Date(end).toISOString(),
      tzOffset: String(tzOffsetForServer(timezone)),
    });
    const res = await fetch(`/api/calendar?${params}`);
    if (res.ok) {
      const d = (await res.json()) as {
        days: DayStat[];
        accounts: AccountOption[];
        latest: string | null;
      };
      setDays(new Map(d.days.map((x) => [x.date, x])));
      setAccounts(d.accounts);
      if (!jumped.current && d.latest) {
        jumped.current = true;
        const [ly, lm] = d.latest.split("-").map(Number);
        if (ly !== v.y || lm - 1 !== v.m) setView({ y: ly, m: lm - 1 });
      }
    }
    setLoading(false);
  }, [v.y, v.m, accountId, timezone]);

  useEffect(() => {
    load();
  }, [load]);

  // Сделки выбранного дня — отдельным запросом по границам локальных суток.
  // Раньше страница фильтровала их из всей истории, лежавшей в браузере.
  useEffect(() => {
    if (!selected) {
      setSelectedTrades([]);
      return;
    }
    let alive = true;
    (async () => {
      const [y, mo, d] = selected.split("-").map(Number);
      const start = zonedDateToUtcMs(y, mo - 1, d, timezone);
      const params = new URLSearchParams({
        accountId,
        from: new Date(start).toISOString(),
        to: new Date(start + DAY_MS).toISOString(),
        sort: "exitTime",
        dir: "asc",
        pageSize: "200",
      });
      const res = await fetch(`/api/trades?${params}`);
      if (res.ok && alive) {
        const d2 = (await res.json()) as { trades: SerializedTrade[] };
        setSelectedTrades(d2.trades);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected, accountId, timezone]);

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
    const { start } = gridRange(v.y, v.m, timezone);
    const cells: { date: string; inMonth: boolean; stat?: DayStat }[] = [];
    for (let i = 0; i < 42; i++) {
      const ts = start + i * DAY_MS;
      const zp = zonedParts(ts, timezone);
      const date = `${zp.y}-${pad(zp.mo + 1)}-${pad(zp.d)}`;
      cells.push({ date, inMonth: zp.mo === v.m, stat: days.get(date) });
    }
    return cells;
  }, [v, days, timezone]);

  // Month summary (only in-month days).
  const monthStat = useMemo(() => {
    let pnl = 0, trades = 0, wins = 0, best = 0;
    for (const c of grid) {
      if (!c.inMonth || !c.stat) continue;
      pnl += c.stat.netPnl;
      trades += c.stat.trades;
      wins += c.stat.wins;
      best = Math.max(best, c.stat.netPnl);
    }
    return { pnl, trades, winRate: trades ? (wins / trades) * 100 : 0, best };
  }, [grid]);

  // Total R for the current month view — сумма уже сохранённых rr (winR+lossR).
  const monthR = useMemo(() => {
    let totalR = 0, rTrades = 0;
    for (const c of grid) {
      if (!c.inMonth || !c.stat) continue;
      totalR += c.stat.winR + c.stat.lossR;
      rTrades += c.stat.rTrades;
    }
    return { totalR, rTrades };
  }, [grid]);

  const weeks = useMemo(() => {
    const rows: (typeof grid)[] = [];
    for (let i = 0; i < 42; i += 7) rows.push(grid.slice(i, i + 7));
    return rows;
  }, [grid]);

  function shiftMonth(delta: number) {
    setSelected(null);
    jumped.current = true;
    let m = v.m + delta;
    let y = v.y;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    setView({ y, m });
  }
  function goToday() {
    setSelected(null);
    jumped.current = true;
    const zp = zonedParts(Date.now(), timezone);
    setView({ y: zp.y, m: zp.mo });
  }

  function cellColor(pnl: number | undefined): string {
    if (pnl === undefined) return "transparent";
    if (pnl === 0) return "var(--color-surface-2)";
    return pnl > 0 ? "rgba(22,199,132,0.14)" : "rgba(234,57,67,0.14)";
  }

  return (
    <div className="px-6 py-5 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold">{t("cal.title")}</h1>
          <p className="text-sm text-muted">{t("cal.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input-base text-sm py-1.5 cursor-pointer"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="all">{t("dash.allAccounts")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.exchange})
              </option>
            ))}
          </select>
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Summary label={t("cal.monthPnl")} value={fmtUsd(monthStat.pnl, { sign: true })} tone={monthStat.pnl >= 0 ? "profit" : "loss"} />
        <Summary label={t("cal.monthR")} value={`${monthR.totalR >= 0 ? "+" : ""}${monthR.totalR.toFixed(1)}R`} tone={monthR.totalR >= 0 ? "profit" : "loss"} />
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
              const weekPnl = week.reduce((s, c) => s + (c.inMonth && c.stat ? c.stat.netPnl : 0), 0);
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
                        style={{ backgroundColor: cellColor(c.stat?.netPnl) }}
                        className={`min-h-[64px] rounded-lg border p-1.5 text-left transition ${
                          c.inMonth ? "border-border" : "border-transparent opacity-40"
                        } ${has ? "cursor-pointer hover:border-border-strong" : "cursor-default"} ${
                          c.date === selected ? "ring-1 ring-accent" : ""
                        }`}
                      >
                        <div className="text-[11px] text-faint">{day}</div>
                        {c.stat && (
                          <>
                            <div className={`mt-1 text-xs font-semibold tabular-nums ${c.stat.netPnl >= 0 ? "text-profit" : "text-loss"}`}>
                              {fmtUsd(c.stat.netPnl, { sign: true })}
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
