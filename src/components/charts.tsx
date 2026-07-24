"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EquityPoint, DailyPoint, Bucket } from "@/lib/analytics/metrics";
import { fmtUsd } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";

const PROFIT = "#16c784";
const LOSS = "#ea3943";
const ACCENT = "#3b82f6";
const GRID = "#242b3a";
const AXIS = "#5c6577";

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function dateShort(t: number): string {
  return new Date(t).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

function TooltipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs shadow-lg">
      {children}
    </div>
  );
}

export function EquityChart({ data }: { data: EquityPoint[] }) {
  if (data.length === 0) return <Empty />;
  return (
    <div className="min-h-[300px] min-w-[300px] w-full">
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={dateShort}
            tick={{ fill: AXIS, fontSize: 11 }}
            stroke={GRID}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={compact}
            tick={{ fill: AXIS, fontSize: 11 }}
            stroke={GRID}
            width={48}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as EquityPoint;
              return (
                <TooltipBox>
                  <div className="text-muted">{new Date(p.t).toLocaleString("ru-RU")}</div>
                  <div className="font-medium">{fmtUsd(p.equity)}</div>
                </TooltipBox>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="equity"
            stroke={ACCENT}
            strokeWidth={2}
            fill="url(#eq)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Custom shape for risk‑decomposition bars: winR (green, above 0) + lossR (red, below 0)
// at the same x position. Uses a single Bar with a computed _rScale dataKey.
function RiskBarShape(props: Record<string, unknown>) {
  const { x, y, width, height, payload } = props as {
    x: number; y: number; width: number; height: number;
    payload: DailyPoint & { _rScale: number };
  };
  if (!payload || height <= 0) return null;
  const { winR, lossR, _rScale } = payload;
  const scale = _rScale / height; // units per pixel
  const baseline = y + height;
  const winH = winR > 0 ? winR / scale : 0;
  const lossH = lossR < 0 ? Math.abs(lossR) / scale : 0;
  const r = 2;
  return (
    <g>
      {winH > 0 && (
        <rect x={x} y={baseline - winH} width={width} height={winH} fill={PROFIT} rx={r} ry={r} />
      )}
      {lossH > 0 && (
        <rect x={x} y={baseline} width={width} height={lossH} fill={LOSS} rx={r} ry={r} />
      )}
    </g>
  );
}

export function DailyPnlChart({
  data,
  metric = "pnl",
}: {
  data: DailyPoint[];
  metric?: "pnl" | "winRate";
}) {
  const { t: tr } = useI18n();
  if (data.length === 0) return <Empty />;
  const isRisk = metric === "winRate";
  const fmtR = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`;

  // Compute Y‑axis domain, capping at the 90th percentile so outlier R‑values
  // (e.g. +50R) don't squash the rest of the chart into invisibility.
  // Bars that exceed the cap are drawn at the maximum height; the exact value is
  // shown in the tooltip only.
  let yDomain: [number, number] | undefined;
  if (isRisk) {
    const winVals = data.map((d) => d.winR).filter((v) => v > 0).sort((a, b) => a - b);
    const lossVals = data.map((d) => Math.abs(d.lossR)).filter((v) => v > 0).sort((a, b) => a - b);
    const atP90 = (arr: number[], def: number) =>
      arr.length > 0 ? arr[Math.min(Math.floor(arr.length * 0.9), arr.length - 1)] : def;
    const cap = Math.max(atP90(winVals, 3), atP90(lossVals, 3), 3);
    yDomain = [-cap * 1.15, cap * 1.15];
  }

  // For risk mode, add a synthetic field that spans the full bar height, capped
  // to the domain so outlier days don't overflow the chart area.
  const chartData = isRisk
    ? data.map((d) => ({
        ...d,
        _rScale: Math.min(Math.max(d.winR, Math.abs(d.lossR), 0.001), yDomain![1]),
      }))
    : data;

  return (
    <div className="min-h-[64px] min-w-[300px] w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData as any} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => dateShort(new Date(d).getTime())}
            tick={{ fill: AXIS, fontSize: 11 }}
            stroke={GRID}
            minTickGap={30}
          />
          <YAxis
            domain={yDomain}
            tickFormatter={isRisk ? (v: number) => `${v.toFixed(1)}R` : compact}
            tick={{ fill: AXIS, fontSize: 11 }}
            stroke={GRID}
            width={48}
          />
          <Tooltip
            cursor={{ fill: "#ffffff08" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as DailyPoint;
              return (
                <TooltipBox>
                  <div className="text-muted">{p.date}</div>
                  {isRisk ? (
                    <>
                      <div className="font-medium text-profit">{fmtR(p.winR)}</div>
                      <div className="font-medium text-loss">{fmtR(p.lossR)}</div>
                      <div className="text-faint">{p.trades} {tr("common.trades")}</div>
                    </>
                  ) : (
                    <div className={p.pnl >= 0 ? "text-profit" : "text-loss"}>
                      {fmtUsd(p.pnl, { sign: true })}
                    </div>
                  )}
                </TooltipBox>
              );
            }}
          />
          {isRisk ? (
            <Bar dataKey="_rScale" shape={<RiskBarShape />} radius={[2, 2, 0, 0]} />
          ) : (
            <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.pnl >= 0 ? PROFIT : LOSS} />
              ))}
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Generic breakdown bar chart (by day-of-week, hour, month, symbol, ТВХ...).
// `metric` selects whether bars show net P&L or win rate.
export function BreakdownChart({
  data,
  height = 240,
  metric = "netPnl",
}: {
  data: Bucket[];
  height?: number;
  metric?: "netPnl" | "winRate";
}) {
  const { t: tr } = useI18n();
  if (data.length === 0) return <Empty />;
  const isWin = metric === "winRate";
  return (
    <div style={{ height, minHeight: 240 }} className="w-full min-w-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: AXIS, fontSize: 11 }}
            stroke={GRID}
            interval={0}
            angle={data.length > 8 ? -35 : 0}
            textAnchor={data.length > 8 ? "end" : "middle"}
            height={data.length > 8 ? 50 : 24}
          />
          <YAxis
            tickFormatter={isWin ? (v: number) => `${Math.round(v)}%` : compact}
            domain={isWin ? [0, 100] : undefined}
            tick={{ fill: AXIS, fontSize: 11 }}
            stroke={GRID}
            width={isWin ? 40 : 48}
          />
          <Tooltip
            cursor={{ fill: "#ffffff08" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Bucket;
              return (
                <TooltipBox>
                  <div className="text-muted">{p.label}</div>
                  {isWin ? (
                    <>
                      <div className="font-medium">{p.winRate.toFixed(1)}% win</div>
                      <div className={p.netPnl >= 0 ? "text-profit" : "text-loss"}>
                        {fmtUsd(p.netPnl, { sign: true })}
                      </div>
                      <div className="text-faint">{p.trades} {tr("common.trades")}</div>
                    </>
                  ) : (
                    <>
                      <div className={p.netPnl >= 0 ? "text-profit" : "text-loss"}>
                        {fmtUsd(p.netPnl, { sign: true })}
                      </div>
                      <div className="text-faint">
                        {p.trades} {tr("common.trades")} · {p.winRate.toFixed(0)}% win
                      </div>
                    </>
                  )}
                </TooltipBox>
              );
            }}
          />
          <Bar dataKey={metric} radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={
                  isWin
                    ? d.winRate >= 50
                      ? PROFIT
                      : LOSS
                    : d.netPnl >= 0
                      ? PROFIT
                      : LOSS
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Drawdown-over-time area (always ≤ 0), derived from the equity curve.
export function DrawdownChart({ data }: { data: EquityPoint[] }) {
  if (data.length === 0) return <Empty />;
  let peak = -Infinity;
  const pts = data.map((p) => {
    peak = Math.max(peak, p.equity);
    return { t: p.t, dd: peak > 0 ? ((p.equity - peak) / peak) * 100 : 0 };
  });
  return (
    <div className="min-h-[200px] min-w-[300px] w-full">
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={pts} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="dd" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LOSS} stopOpacity={0.05} />
              <stop offset="100%" stopColor={LOSS} stopOpacity={0.35} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={dateShort} tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} minTickGap={40} />
          <YAxis tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={44} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { t: number; dd: number };
              return (
                <TooltipBox>
                  <div className="text-muted">{new Date(p.t).toLocaleDateString("ru-RU")}</div>
                  <div className="text-loss">{p.dd.toFixed(2)}%</div>
                </TooltipBox>
              );
            }}
          />
          <Area type="monotone" dataKey="dd" stroke={LOSS} strokeWidth={1.5} fill="url(#dd)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Generic histogram: counts per labelled bin, coloured by tone.
export function Histogram({
  data,
  height = 240,
}: {
  data: { label: string; count: number; tone?: "profit" | "loss" | "neutral" }[];
  height?: number;
}) {
  if (data.length === 0) return <Empty />;
  const color = (tone?: string) =>
    tone === "profit" ? PROFIT : tone === "loss" ? LOSS : ACCENT;
  return (
    <div style={{ height, minHeight: 240 }} className="w-full min-w-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 10 }} stroke={GRID} interval={0} angle={data.length > 6 ? -30 : 0} textAnchor={data.length > 6 ? "end" : "middle"} height={data.length > 6 ? 44 : 24} />
          <YAxis allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={32} />
          <Tooltip
            cursor={{ fill: "#ffffff08" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { label: string; count: number };
              return (
                <TooltipBox>
                  <div className="text-muted">{p.label}</div>
                  <div className="font-medium">{p.count}</div>
                </TooltipBox>
              );
            }}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={color(d.tone)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Empty() {
  const { t } = useI18n();
  return (
    <div className="h-48 flex items-center justify-center text-sm text-faint">
      {t("dash.noData")}
    </div>
  );
}
