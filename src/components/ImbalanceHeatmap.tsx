"use client";

import { useMemo } from "react";
import { HelpCircle } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
  Cell,
  ReferenceLine,
} from "recharts";
import { useI18n } from "@/lib/i18n/provider";
import type { Imbalance } from "@/lib/orderflow";

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtVal(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(0);
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (z: number) => String(z).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
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

function ImbalanceTooltip({ active, payload }: { active?: boolean; payload?: { payload: { time: number; ratio: number } }[] }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const side = d.ratio < -0.1 ? "Bid dominance" : d.ratio > 0.1 ? "Ask dominance" : "Neutral";
  return (
    <div className="rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs shadow-lg">
      <div className="text-faint">{fmtTime(d.time)}</div>
      <div className={d.ratio < 0 ? "text-profit" : d.ratio > 0 ? "text-loss" : "text-muted"}>
        Ratio: {d.ratio.toFixed(3)}
      </div>
      <div className="text-faint mt-0.5">{side}</div>
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
  const { t } = useI18n();

  // Loading state.
  if (loading) {
    return (
      <div className="card p-3 mt-3">
        <div className="text-xs font-medium text-muted mb-2 inline-flex items-center gap-1.5">
          {t("of.imbalanceTitle") || "Bid/Ask Imbalance"}
          <HelpCircle size={12} className="text-faint shrink-0" />
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
          <HelpCircle size={12} className="text-faint shrink-0" />
        </div>
        <div className="text-sm text-loss">{error}</div>
      </div>
    );
  }

  // Empty state.
  if (!data || data.times.length === 0) {
    return (
      <div className="card p-3 mt-3">
        <div className="text-xs font-medium text-muted mb-2 inline-flex items-center gap-1.5">
          {t("of.imbalanceTitle") || "Bid/Ask Imbalance"}
          <HelpCircle size={12} className="text-faint shrink-0" />
        </div>
        <div className="text-xs text-faint">{t("of.noImbalance") || "No imbalance data"}</div>
      </div>
    );
  }

  return <ImbalanceChart data={data} />;
}

// ─── Chart ────────────────────────────────────────────────────────────────

function ImbalanceChart({ data }: { data: Imbalance }) {
  const { t } = useI18n();

  const chartData = useMemo(() => {
    return data.times.map((t, i) => ({
      time: t,
      ratio: data.ratio[i] ?? 0,
      fullBid: data.fullBid[i] ?? 0,
      fullAsk: data.fullAsk[i] ?? 0,
    }));
  }, [data]);

  const maxAbs = useMemo(
    () => Math.max(0.01, ...data.ratio.map((r) => Math.abs(r))),
    [data.ratio],
  );

  const alertCount = data.alerts.length;

  return (
    <div className="card p-3 mt-3">
      <div className="text-xs font-medium text-muted mb-1 inline-flex items-center gap-1.5">
        {t("of.imbalanceTitle") || "Bid/Ask Imbalance"}
        <span title={t("of.imbalanceHint") || "Bid/Ask Imbalance — ratio of ask to bid volume. -1 = only bids, 0 = equal, +1 = only asks."} className="inline-flex cursor-help">
          <HelpCircle size={12} className="text-faint shrink-0" />
        </span>
      </div>
      <div className="text-[11px] text-faint mb-2">
        {t("of.imbalanceHint") || "Imbalance ratio: ask dominance (red) / bid dominance (green)"}
        {alertCount > 0 && (
          <span className="ml-2 text-accent">
            &middot; {alertCount} {t("of.alerts") || "alerts"}
          </span>
        )}
      </div>

      <div className="h-20 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
            barCategoryGap={1}
          >
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
            <XAxis
              dataKey="time"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={fmtTime}
              tick={{ fill: AXIS, fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              hide
            />
            <YAxis
              type="number"
              domain={[-maxAbs * 1.1, maxAbs * 1.1]}
              tick={{ fill: AXIS, fontSize: 9 }}
              tickFormatter={(v: number) => v.toFixed(1)}
              tickLine={false}
              axisLine={false}
              width={30}
            />
            <Tooltip content={<ImbalanceTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
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