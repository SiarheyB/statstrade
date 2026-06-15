"use client";

import { useState } from "react";
import type { DailyPoint } from "@/lib/analytics/metrics";
import { fmtUsd } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/core";

const DAY_MS = 24 * 3600 * 1000;
const MAX_WEEKS = 26;

type Cell = { date: string; pnl: number | null; trades: number };
type Hover = { cell: Cell; x: number; y: number };

function toUtc(date: string): number {
  return new Date(date + "T00:00:00Z").getTime();
}

function isoDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function formatDay(date: string, locale: Locale): string {
  return new Date(date + "T00:00:00Z").toLocaleDateString(
    locale === "en" ? "en-US" : "ru-RU",
    { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" },
  );
}

export default function PnlHeatmap({ daily }: { daily: DailyPoint[] }) {
  const { t, locale } = useI18n();
  const [hover, setHover] = useState<Hover | null>(null);

  if (daily.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-sm text-faint">
        {t("dash.noData")}
      </div>
    );
  }

  const map = new Map(daily.map((d) => [d.date, d]));
  const last = toUtc(daily[daily.length - 1].date);
  const earliest = toUtc(daily[0].date);
  let start = Math.max(earliest, last - (MAX_WEEKS * 7 - 1) * DAY_MS);

  // align start to Monday
  const startDay = new Date(start).getUTCDay(); // 0=Sun
  const backToMonday = (startDay + 6) % 7;
  start -= backToMonday * DAY_MS;

  const cells: Cell[] = [];
  for (let t = start; t <= last; t += DAY_MS) {
    const date = isoDay(t);
    const d = map.get(date);
    cells.push({ date, pnl: d ? d.pnl : null, trades: d ? d.trades : 0 });
  }

  const weeks: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  const maxAbs = Math.max(
    1,
    ...cells.filter((c) => c.pnl !== null).map((c) => Math.abs(c.pnl!)),
  );

  function color(pnl: number | null): string {
    if (pnl === null) return "var(--color-surface-2)";
    if (pnl === 0) return "var(--color-border)";
    const intensity = 0.25 + 0.75 * Math.min(1, Math.sqrt(Math.abs(pnl) / maxAbs));
    return pnl > 0
      ? `rgba(22,199,132,${intensity})`
      : `rgba(234,57,67,${intensity})`;
  }

  return (
    <div className="relative">
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((cell) => (
              <div
                key={cell.date}
                onMouseEnter={(e) => setHover({ cell, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHover({ cell, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
                className="h-3 w-3 rounded-[2px] cursor-pointer hover:ring-1 hover:ring-fg/40"
                style={{ backgroundColor: color(cell.pnl) }}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3 text-xs text-faint">
        <span>{t("trades.loss")}</span>
        <span className="h-3 w-3 rounded-[2px]" style={{ background: "rgba(234,57,67,0.9)" }} />
        <span className="h-3 w-3 rounded-[2px]" style={{ background: "var(--color-surface-2)" }} />
        <span className="h-3 w-3 rounded-[2px]" style={{ background: "rgba(22,199,132,0.9)" }} />
        <span>{t("trades.win")}</span>
      </div>

      {hover && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs shadow-lg"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <div className="text-muted">{formatDay(hover.cell.date, locale)}</div>
          {hover.cell.pnl === null ? (
            <div className="text-faint">{t("dash.noData")}</div>
          ) : (
            <>
              <div className={hover.cell.pnl >= 0 ? "text-profit font-medium" : "text-loss font-medium"}>
                {fmtUsd(hover.cell.pnl, { sign: true })}
              </div>
              <div className="text-faint">
                {hover.cell.trades}{" "}
                {pluralTrades(hover.cell.trades, locale)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function pluralTrades(n: number, locale: Locale): string {
  if (locale === "en") return n === 1 ? "trade" : "trades";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "сделка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "сделки";
  return "сделок";
}
