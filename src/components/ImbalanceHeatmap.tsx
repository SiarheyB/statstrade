"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell, ReferenceLine } from "recharts";
import { useI18n } from "@/lib/i18n/provider";
import { HelpCircle } from "lucide-react";
import type { Imbalance } from "@/lib/orderflow";
import { zonedParts, type TimezoneId } from "@/lib/timezone";

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtVal(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(0);
}

// Всегда показываем дату + время (а не только HH:MM) и в выбранном
// пользователем часовом поясе (zonedParts, как в остальных графиках проекта) —
// иначе при окне в несколько дней подписи по HH:MM выглядят "перепутанными",
// когда дата на самом деле просто перевалила за полночь.
function fmtTime(ms: number, tz: TimezoneId): string {
  const { d, mo, h, mi } = zonedParts(ms, tz);
  const p = (z: number) => String(z).padStart(2, "0");
  return `${p(d)}.${p(mo + 1)} ${p(h)}:${p(mi)}`;
}

// ─── Colors ────────────────────────────────────────────────────────────────

const GRID = "#242b3a";
const AXIS = "#5c6577";
const ZERO_LINE = "rgba(255,255,255,0.12)";

// Цвет бара в зависимости от imbalance ratio: -1 (зелёный) → 0 (серый) → +1 (красный).
function barColor(r: number): string {
  if (r < -0.3) return "#16c784"; // сильный bid
  if (r < -0.1) return "rgba(22,199,132,0.5)"; // слабый bid
  if (r > 0.3) return "#ea3943"; // сильный ask
  if (r > 0.1) return "rgba(234,57,67,0.5)"; // слабый ask
  return "#3a4354"; // нейтрально
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────

function ImbalanceTooltip({
  t,
  timezone,
  active,
  payload,
}: {
  t: (k: string, p?: Record<string, string | number>) => string;
  timezone: TimezoneId;
  active?: boolean;
  payload?: { payload: { time: number; ratio: number } }[];
}) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const isBid = d.ratio < -0.1;
  const isAsk = d.ratio > 0.1;
  const sideKey = isBid ? "of.imbalanceBidDominance" : isAsk ? "of.imbalanceAskDominance" : "of.imbalanceNeutral";
  const actionKey = isBid ? "of.imbalanceBidAction" : isAsk ? "of.imbalanceAskAction" : "of.imbalanceNeutralAction";
  return (
    <div className="rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs shadow-lg max-w-[260px]">
      <div className="text-faint">{fmtTime(d.time, timezone)}</div>
      <div className={d.ratio < 0 ? "text-profit" : d.ratio > 0 ? "text-loss" : "text-muted"}>
        {t("of.imbalanceRatio", { ratio: d.ratio.toFixed(3) })}
      </div>
      <div className="text-faint mt-0.5">{t(sideKey)}</div>
      {isBid || isAsk ? (
        <div className="text-faint/70 mt-1.5 pt-1.5 border-t border-border/20 leading-tight">
          {t(actionKey)}
        </div>
      ) : null}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────

export default function ImbalanceHeatmap({
  data,
  loading,
  error,
}: {
  data: Imbalance | null;
  loading: boolean;
  error: string | null;
}) {
  const { t, timezone } = useI18n();

  // Хук должен вызываться на каждом рендере в одном и том же порядке —
  // до любых early return (loading/error/empty), иначе React теряет
  // синхронизацию хуков между рендерами ("Rendered more hooks...").
  const chartData = useMemo(() =>
    data ? data.times.map((t, i) => ({ time: t, ratio: data.ratio[i] ?? 0 })) : [],
    [data],
  );

  // Loading state.
  if (loading) {
    return (
      <div className="card p-3 mt-3">
        <div className="text-xs font-medium text-muted mb-2 inline-flex items-center gap-1.5">
          {t("of.imbalanceTitle") || "Bid/Ask Imbalance"}
          <span title={t("of.imbalanceHint")} className="inline-flex cursor-help"><HelpCircle size={12} className="text-faint shrink-0" /></span>
        </div>
        <div className="flex items-center justify-center h-16 text-sm text-faint">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  // Error state.
  if (error) {
    return (
      <div className="card p-3 mt-3">
        <div className="text-xs font-medium text-muted mb-2 inline-flex items-center gap-1.5">
          {t("of.imbalanceTitle") || "Bid/Ask Imbalance"}
          <span title={t("of.imbalanceHint")} className="inline-flex cursor-help"><HelpCircle size={12} className="text-faint shrink-0" /></span>
        </div>
        <div className="text-sm text-loss">
          {error}
        </div>
      </div>
    );
  }

  // Empty state.
  if (!data || data.times.length === 0) {
    return (
      <div className="card p-3 mt-3">
        <div className="text-xs font-medium text-muted mb-2 inline-flex items-center gap-1.5">
          {t("of.imbalanceTitle") || "Bid/Ask Imbalance"}
          <span title={t("of.imbalanceHint")} className="inline-flex cursor-help"><HelpCircle size={12} className="text-faint shrink-0" /></span>
        </div>
        <div className="text-xs text-faint">
          {t("of.noImbalance") || "No imbalance data"}
        </div>
      </div>
    );
  }

  return (
    <div className="card p-3 mt-3">
      <div className="text-xs font-medium text-muted mb-1 inline-flex items-center gap-1.5">
        {t("of.imbalanceTitle") || "Bid/Ask Imbalance"}
        <span title={t("of.imbalanceHint")} className="inline-flex cursor-help"><HelpCircle size={12} className="text-faint shrink-0" /></span>
      </div>
      {data && data.alerts && data.alerts.length > 0 && (
        <div className="text-xs text-muted mb-2">
          {data.alerts.length} {t("of.alerts") || "alerts"}
        </div>
      )}
      <div className="w-full" style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
          >
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
            <XAxis
              dataKey="time"
              type="number"
              domain={[data.times[0], data.times[data.times.length - 1]]}
              tickFormatter={(ms: number) => fmtTime(ms, timezone)}
              tick={{ fill: AXIS, fontSize: 9 }}
              stroke={GRID}
              minTickGap={40}
            />
            <YAxis
              type="number"
              domain={[-1.1, 1.1]}
              tickFormatter={(v: number) => v.toFixed(1)}
              tick={{ fill: AXIS, fontSize: 9 }}
              stroke={GRID}
              width={30}
            />
            <Tooltip content={<ImbalanceTooltip t={t} timezone={timezone} />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <ReferenceLine y={0} stroke={ZERO_LINE} strokeWidth={1} />
            <Bar dataKey="ratio" isAnimationActive={false} minPointSize={1}>
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={barColor(entry.ratio)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}