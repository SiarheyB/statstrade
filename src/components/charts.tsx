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
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
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

export function DailyPnlChart({
  data,
  metric = "pnl",
}: {
  data: DailyPoint[];
  metric?: "pnl" | "winRate";
}) {
  const { t: tr } = useI18n();
  if (data.length === 0) return <Empty />;
  const isWin = metric === "winRate";
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => dateShort(new Date(d).getTime())}
            tick={{ fill: AXIS, fontSize: 11 }}
            stroke={GRID}
            minTickGap={30}
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
              const p = payload[0].payload as DailyPoint;
              return (
                <TooltipBox>
                  <div className="text-muted">{p.date}</div>
                  {isWin ? (
                    <>
                      <div className="font-medium">{p.winRate.toFixed(1)}% win</div>
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
          <Bar dataKey={metric} radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={isWin ? (d.winRate >= 50 ? PROFIT : LOSS) : d.pnl >= 0 ? PROFIT : LOSS} />
            ))}
          </Bar>
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
    <div style={{ height }} className="w-full">
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
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
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
    <div style={{ height }} className="w-full">
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
