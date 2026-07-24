"use client";

import { useCallback, useMemo } from "react";
import { HelpCircle } from "lucide-react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  CartesianGrid,
} from "recharts";
import { useI18n } from "@/lib/i18n/provider";

// ─── Types (mirror from lib/orderflow.ts) ─────────────────────────────────

export type VolumeProfileLevel = {
  price: number;
  volume: number;
  isPoc: boolean;
  isVa: boolean;
  pct: number;
};

export type VolumeProfile = {
  poc: number;
  vah: number;
  val: number;
  levels: VolumeProfileLevel[];
  totalVolume: number;
  pocVolume: number;
  valueAreaVolume: number;
  valueAreaPct: number;
  binSize: number;
};

// ─── Colors ───────────────────────────────────────────────────────────────

const HVN_COLOR = "#16c784"; // зелёный — высокий объём
const LVN_COLOR = "#3a4354"; // тёмно-серый — низкий объём
const POC_COLOR = "#e6b800"; // жёлтый — POC (максимум)
const VA_BG = "rgba(22,199,132,0.06)"; // фон Value Area
const GRID = "#242b3a";
const AXIS = "#5c6577";

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtVal(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(0);
}

function fmtP(p: number): string {
  if (p >= 1000) return Math.round(p).toLocaleString("en-US");
  if (p >= 1) return p.toFixed(2);
  return p.toPrecision(4);
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────

function VPTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: VolumeProfileLevel }[]; label?: string }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const tags: string[] = [];
  if (d.isPoc) tags.push("POC");
  if (d.isVa) tags.push("VA");
  return (
    <div className="rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs shadow-lg">
      <div className="text-fg font-medium">{fmtP(d.price)}</div>
      <div className="text-muted mt-0.5">Volume: {fmtVal(d.volume)}</div>
      <div className="text-faint mt-0.5">({d.pct.toFixed(1)}% of max)</div>
      {tags.length > 0 && (
        <div className="mt-1 flex gap-1">
          {tags.map((tag) => (
            <span key={tag} className="rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────

export default function VolumeProfile({
  data,
  loading,
  error,
}: {
  data: VolumeProfile | null;
  loading: boolean;
  error: string | null;
}) {
  const { t } = useI18n();

  // Loading state.
  if (loading) {
    return (
      <div className="card p-3">
        <div className="text-xs font-medium text-muted mb-2 inline-flex items-center gap-1.5">
          {(t("of.volumeProfile") as string) || "Volume Profile"}
          <span title="Volume Profile — горизонтальный профиль объёмов: распределение торгового объёма по ценовым уровням за выбранный период." className="inline-flex cursor-help">
            <HelpCircle size={12} className="text-faint shrink-0" />
          </span>
        </div>
        <div className="flex items-center justify-center h-48 text-sm text-faint">
          {t("common.loading") as string}
        </div>
      </div>
    );
  }

  // Error state.
  if (error) {
    return (
      <div className="card p-3">
        <div className="text-xs font-medium text-muted mb-2 inline-flex items-center gap-1.5">
          {(t("of.volumeProfile") as string) || "Volume Profile"}
          <span title="Volume Profile — горизонтальный профиль объёмов." className="inline-flex cursor-help">
            <HelpCircle size={12} className="text-faint shrink-0" />
          </span>
        </div>
        <div className="flex items-center justify-center h-48 text-sm text-loss">
          {error}
        </div>
      </div>
    );
  }

  // Empty state.
  if (!data || data.levels.length === 0) {
    return (
      <div className="card p-3">
        <div className="text-xs font-medium text-muted mb-2 inline-flex items-center gap-1.5">
          {(t("of.volumeProfile") as string) || "Volume Profile"}
          <span title="Volume Profile — горизонтальный профиль объёмов." className="inline-flex cursor-help">
            <HelpCircle size={12} className="text-faint shrink-0" />
          </span>
        </div>
        <div className="flex items-center justify-center h-48 text-sm text-faint">
          {(t("of.noVolumeProfile") as string) || "No data"}
        </div>
      </div>
    );
  }

  return <VolumeProfileChart data={data} />;
}

// ─── Chart (separate component to keep re-renders contained) ──────────────

function VolumeProfileChart({ data }: { data: VolumeProfile }) {
  const { t, timezone } = useI18n();

  // Sort levels by price ascending (Y axis).
  const chartData = useMemo(() => {
    return [...data.levels].sort((a, b) => a.price - b.price);
  }, [data.levels]);

  // Find the max volume for scaling.
  const maxVol = useMemo(
    () => Math.max(...chartData.map((l) => l.volume)),
    [chartData],
  );

  const barFill = useCallback((entry: VolumeProfileLevel) => {
    if (entry.isPoc) return POC_COLOR;
    // HVN: выше 50% от max → зелёный
    if (entry.pct >= 50) return HVN_COLOR;
    // LVN: ниже 20% от max → затемнённый
    if (entry.pct < 20) return LVN_COLOR;
    // Средний объём — полупрозрачный зелёный
    return "rgba(22,199,132,0.35)";
  }, []);

  const numTicks = Math.min(chartData.length, 10);

  return (
    <div className="card p-3">
      <div className="text-xs font-medium text-muted mb-2 inline-flex items-center gap-1.5">
        {(t("of.volumeProfile") as string) || "Volume Profile"}
        <span title="Volume Profile — горизонтальный профиль объёмов: распределение торгового объёма по ценовым уровням за выбранный период. POC (Point of Control) — цена с максимальным объёмом, VAH/VAL — границы Value Area (70% объёма). HVN — зоны высокого объёма, LVN — зоны низкого объёма." className="inline-flex cursor-help">
          <HelpCircle size={12} className="text-faint shrink-0" />
        </span>
      </div>

      {/* Value Area labels */}
      <div className="flex items-center gap-3 mb-2 text-[11px] text-faint tabular-nums">
        <span title="Point of Control — цена с максимальным объёмом за период">
          POC: <span className="text-accent font-medium">{fmtP(data.poc)}</span>
        </span>
        <span title="Value Area High — верхняя граница зоны справедливой цены (70% объёма)">
          VAH: <span className="text-profit">{fmtP(data.vah)}</span>
        </span>
        <span title="Value Area Low — нижняя граница зоны справедливой цены (70% объёма)">
          VAL: <span className="text-loss">{fmtP(data.val)}</span>
        </span>
        <span className="text-faint/60" title="Суммарный объём торгов за выбранный период">
          Vol: {fmtVal(data.totalVolume)}
        </span>
      </div>

      {/* Horizontal bar chart: price on Y, volume on X */}
      <div className="w-full">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 8, left: 4, bottom: 0 }}
            barCategoryGap={1}
          >
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: AXIS, fontSize: 10 }}
              tickFormatter={fmtVal}
              domain={[0, maxVol * 1.1]}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="number"
              dataKey="price"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: AXIS, fontSize: 10 }}
              tickFormatter={fmtP}
              tickCount={numTicks}
              tickLine={false}
              axisLine={false}
              width={60}
              orientation="right"
            />
            <Tooltip content={<VPTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />

            {/* Value Area background */}
            <ReferenceArea
              y1={data.val}
              y2={data.vah}
              fill={VA_BG}
              stroke="none"
            />

            {/* POC reference line */}
            <ReferenceLine
              y={data.poc}
              stroke={POC_COLOR}
              strokeWidth={1.5}
              strokeDasharray="4 2"
              label={{
                value: "POC",
                position: "insideTopRight",
                fill: POC_COLOR,
                fontSize: 10,
              }}
            />

            {/* VAH reference line */}
            <ReferenceLine
              y={data.vah}
              stroke="#16c784"
              strokeWidth={1}
              strokeDasharray="3 3"
              label={{
                value: "VAH",
                position: "insideTopRight",
                fill: "#16c784",
                fontSize: 10,
              }}
            />

            {/* VAL reference line */}
            <ReferenceLine
              y={data.val}
              stroke="#ea3943"
              strokeWidth={1}
              strokeDasharray="3 3"
              label={{
                value: "VAL",
                position: "insideTopRight",
                fill: "#ea3943",
                fontSize: 10,
              }}
            />

            <Bar dataKey="volume" isAnimationActive={false} minPointSize={1}>
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={barFill(entry)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-faint">
        <span className="inline-flex items-center gap-1.5" title="High Volume Node — зона высокого объёма (≥50% от POC), сильный уровень поддержки/сопротивления">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: HVN_COLOR }} />
          HVN
        </span>
        <span className="inline-flex items-center gap-1.5" title="Low Volume Node — зона низкого объёма (&lt;20% от POC), цена проходит быстро">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: LVN_COLOR }} />
          LVN
        </span>
        <span className="inline-flex items-center gap-1.5" title="Point of Control — уровень с максимальным объёмом, сильнейший уровень">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: POC_COLOR }} />
          POC
        </span>
        <span className="inline-flex items-center gap-1.5" title={`Value Area — зона справедливой цены, содержащая ${(data.valueAreaPct * 100).toFixed(0)}% всего объёма`}>
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: VA_BG }} />
          Value Area ({(data.valueAreaPct * 100).toFixed(0)}%)
        </span>
      </div>
    </div>
  );
}