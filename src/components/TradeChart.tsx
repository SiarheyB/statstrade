"use client";

import { useEffect, useMemo, useState } from "react";
import type { SerializedTrade } from "@/lib/types";
import { fmtPrice, fmtPct } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { computeExitAnalysis, candlesLookReal } from "@/lib/analytics/exitAnalysis";
import { Term } from "@/components/Term";

type Candle = { t: number; o: number; h: number; l: number; c: number };

// Module-level caches so re-hovering the same trade doesn't refetch.
const candleCache = new Map<string, Candle[]>();
const noRealData = new Set<string>();

const PROFIT = "#16c784";
const LOSS = "#ea3943";
const AXIS = "#5c6577";
const GRID = "#242b3a";
const ENTRY = "#e7eaf0";
const SL_COLOR = "#f0b90b";
const BEST_COLOR = "#8b5cf6";

// SVG layout (viewBox units; container keeps the aspect ratio).
const W = 336;
const H = 168;
const PAD_L = 48;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 8;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

// Deterministic PRNG seeded from the trade id (stable across re-renders).
function seeded(id: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Illustrative OHLC candles from entry to exit (until/if real candles load).
function buildSchematic(trade: SerializedTrade): Candle[] {
  const t0 = new Date(trade.entryTime).getTime();
  const t1 = new Date(trade.exitTime).getTime();
  const rng = seeded(trade.id);
  const n = 20;
  const amp = Math.abs(trade.exitPrice - trade.entryPrice) || trade.entryPrice * 0.01;
  const candles: Candle[] = [];
  let prevClose = trade.entryPrice;
  for (let i = 0; i < n; i++) {
    const f = (i + 1) / n;
    const target = trade.entryPrice + (trade.exitPrice - trade.entryPrice) * f;
    const wobble = Math.sin(f * Math.PI) * (rng() - 0.5) * amp * 0.8;
    const close = i === n - 1 ? trade.exitPrice : target + wobble;
    const open = i === 0 ? trade.entryPrice : prevClose;
    const wick = (0.0015 + rng() * 0.003) * Math.max(open, close);
    candles.push({
      t: t0 + ((t1 - t0) * i) / (n - 1),
      o: open,
      c: close,
      h: Math.max(open, close) + wick,
      l: Math.min(open, close) - wick,
    });
    prevClose = close;
  }
  return candles;
}

export function TradeChart({ trade }: { trade: SerializedTrade }) {
  const { t } = useI18n();
  const schematic = useMemo(() => buildSchematic(trade), [trade]);
  const [data, setData] = useState<Candle[] | null>(
    () => candleCache.get(trade.id) ?? null,
  );
  const [real, setReal] = useState(candleCache.has(trade.id));
  const [loading, setLoading] = useState(!candleCache.has(trade.id));

  const entryT = new Date(trade.entryTime).getTime();
  const exitT = new Date(trade.exitTime).getTime();

  useEffect(() => {
    if (candleCache.has(trade.id)) {
      setData(candleCache.get(trade.id)!);
      setReal(true);
      setLoading(false);
      return;
    }
    if (noRealData.has(trade.id)) {
      setReal(false);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({
      exchange: trade.exchange,
      symbol: trade.symbol,
      market: trade.market,
      from: String(entryT),
      to: String(exitT),
    });
    fetch(`/api/trade-chart?${params}`)
      .then((r) => r.json())
      .then((j: { candles?: number[][] }) => {
        if (!active) return;
        if (j.candles) {
          const cs: Candle[] = j.candles.map((c) => ({
            t: c[0],
            o: c[1],
            h: c[2],
            l: c[3],
            c: c[4],
          }));
          if (candlesLookReal(cs, trade.entryPrice, trade.exitPrice)) {
            candleCache.set(trade.id, cs);
            setData(cs);
            setReal(true);
            setLoading(false);
            return;
          }
        }
        noRealData.add(trade.id);
        setReal(false);
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          noRealData.add(trade.id);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.id]);

  // Пока реальные свечи грузятся — НЕ показываем схематичную заглушку (она
  // выглядела как «непонятные свечи»); вместо этого плейсхолдер «Загрузка…».
  if (loading) {
    return (
      <div
        style={{ height: H }}
        className="w-full flex items-center justify-center gap-2 text-xs text-faint"
      >
        <span className="h-3 w-3 rounded-full border-2 border-faint/40 border-t-accent animate-spin" />
        {t("trades.chart.loading")}
      </div>
    );
  }

  const candles = real && data ? data : schematic;
  const sl = trade.stopLoss ?? null;
  const exitColor = trade.netPnl >= 0 ? PROFIT : LOSS;
  // MFE/MAE only makes sense against real market candles — on the schematic
  // fallback the wicks are fabricated, so "best exit" would be meaningless.
  const exitAnalysis =
    real && data ? computeExitAnalysis(data, trade.side, trade.entryPrice, trade.exitPrice) : null;

  // Y domain over highs/lows plus markers (entry, exit, stop).
  const ys = [
    ...candles.map((c) => c.h),
    ...candles.map((c) => c.l),
    trade.entryPrice,
    trade.exitPrice,
    ...(sl != null ? [sl] : []),
  ];
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const range = hi - lo || hi * 0.01 || 1;
  const dLo = lo - range * 0.06;
  const dHi = hi + range * 0.06;

  const n = candles.length;
  const slot = PLOT_W / n;
  const bodyW = Math.max(0.6, Math.min(slot * 0.65, 9));
  const t0 = candles[0].t;
  const tN = candles[n - 1].t;

  const y = (p: number) => PAD_T + (1 - (p - dLo) / (dHi - dLo)) * PLOT_H;
  const cx = (i: number) => PAD_L + slot * (i + 0.5);
  const timeX = (t: number) => {
    const frac = tN > t0 ? (t - t0) / (tN - t0) : 0;
    return PAD_L + slot * (frac * (n - 1) + 0.5);
  };

  // Y axis ticks
  const ticks = [dLo, (dLo + dHi) / 2, dHi];

  return (
    <div>
      <div style={{ height: H }} className="w-full">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%">
          {/* gridlines + y labels */}
          {ticks.map((p, i) => (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y(p)}
                y2={y(p)}
                stroke={GRID}
                strokeDasharray="3 3"
              />
              <text x={PAD_L - 5} y={y(p) + 3} textAnchor="end" fill={AXIS} fontSize={9}>
                {fmtPrice(p)}
              </text>
            </g>
          ))}

          {/* candles */}
          {candles.map((c, i) => {
            const up = c.c >= c.o;
            const color = up ? PROFIT : LOSS;
            const x = cx(i);
            const yo = y(c.o);
            const yc = y(c.c);
            const bodyTop = Math.min(yo, yc);
            const bodyH = Math.max(1, Math.abs(yc - yo));
            return (
              <g key={i}>
                <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} />
                <rect
                  x={x - bodyW / 2}
                  y={bodyTop}
                  width={bodyW}
                  height={bodyH}
                  fill={color}
                />
              </g>
            );
          })}

          {/* stop-loss line */}
          {sl != null && (
            <g>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y(sl)}
                y2={y(sl)}
                stroke={SL_COLOR}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              <text x={W - PAD_R} y={y(sl) - 3} textAnchor="end" fill={SL_COLOR} fontSize={9}>
                SL {fmtPrice(sl)}
              </text>
            </g>
          )}

          {/* best-exit line (MFE) — the theoretical "perfect exit" price */}
          {exitAnalysis && (
            <g>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y(exitAnalysis.bestPrice)}
                y2={y(exitAnalysis.bestPrice)}
                stroke={BEST_COLOR}
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              <text x={PAD_L + 2} y={y(exitAnalysis.bestPrice) - 3} textAnchor="start" fill={BEST_COLOR} fontSize={9}>
                {t("trades.chart.best")} {fmtPrice(exitAnalysis.bestPrice)}
              </text>
            </g>
          )}

          {/* entry / exit markers */}
          <circle cx={timeX(entryT)} cy={y(trade.entryPrice)} r={3.5} fill={ENTRY} stroke="#0b0e13" strokeWidth={1} />
          <circle cx={timeX(exitT)} cy={y(trade.exitPrice)} r={3.5} fill={exitColor} stroke="#0b0e13" strokeWidth={1} />
        </svg>
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] text-faint">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-fg" /> {t("trades.chart.entry")} {fmtPrice(trade.entryPrice)}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: exitColor }} /> {t("trades.chart.exit")} {fmtPrice(trade.exitPrice)}
        </span>
        {sl != null && (
          <span className="inline-flex items-center gap-1" style={{ color: SL_COLOR }}>
            SL {fmtPrice(sl)}
          </span>
        )}
        <span>{loading ? t("trades.chart.loading") : real ? t("trades.chart.real") : t("trades.chart.schematic")}</span>
      </div>
      {exitAnalysis && (
        <div className="mt-1 flex items-center justify-between text-[10px] text-faint">
          <span>
            <Term name="MFE">{t("trades.chart.mfe")}</Term>{" "}
            <span className="text-profit">{fmtPct(exitAnalysis.mfePct)}</span>
          </span>
          <span>
            <Term name="MAE">{t("trades.chart.mae")}</Term>{" "}
            <span className="text-loss">{fmtPct(exitAnalysis.maePct)}</span>
          </span>
          <span>
            {t("trades.chart.captured")}{" "}
            <span className={exitAnalysis.capturedPct >= 0 ? "text-profit" : "text-loss"}>
              {fmtPct(exitAnalysis.capturedPct, 0)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
