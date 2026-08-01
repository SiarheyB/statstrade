// Shared canvas candlestick chart primitives — used by both /dashboard/orderflow
// and /dashboard/forex. Any visual fix here (grid, candles, crosshair, delta/CVD)
// applies to every page that renders a chart, instead of being duplicated per page.

import { zonedParts, type TimezoneId } from "@/lib/timezone";

export type Candle = { t: number; o: number; h: number; l: number; c: number };

export const CHART_COLORS = {
  bg: "#0a0b10",
  up: "#13af74",
  down: "#ce323b",
  grid: "rgba(255,255,255,0.08)",
  gridWeak: "rgba(255,255,255,0.06)",
  axisText: "#8a93a6",
  axisTextStrong: "#9aa2b3",
  axisTextWeak: "#6b7384",
  accent: "#e6b800",
  crosshair: "rgba(255,255,255,0.35)",
  tooltipBg: "rgba(16,18,26,0.96)",
  tooltipBorder: "rgba(255,255,255,0.18)",
  tooltipText: "#e6eaf2",
};

// Standard chart padding — kept identical across pages so charts line up visually.
export const PADL = 8;
export const PADR = 64;
export const PADB = 20;
export const PRICE_AXIS_W = 76;

export type PlotLayout = { plotX: number; plotW: number; plotH: number; W: number; H: number };

export function computePlotLayout(W: number, H: number, padBottom = PADB): PlotLayout {
  const plotX = PADL + PRICE_AXIS_W;
  const plotW = W - plotX - PADR;
  const plotH = H - padBottom;
  return { plotX, plotW, plotH, W, H };
}

export function fmtPriceLabel(p: number): string {
  if (p >= 1000) return Math.round(p).toLocaleString("en-US");
  if (p >= 1) return p.toFixed(2);
  return p.toPrecision(4);
}

export function fmtValLabel(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return String(Math.round(v));
}

export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const frac = raw / base;
  const niceFrac = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  return niceFrac * base;
}

const TIME_STEPS_MS = [
  1000, 5000, 15000, 30000,
  60000, 5 * 60000, 15 * 60000, 30 * 60000,
  3600000, 2 * 3600000, 4 * 3600000, 6 * 3600000, 12 * 3600000,
  86400000, 2 * 86400000, 7 * 86400000, 30 * 86400000,
];
export function niceTimeStep(xspan: number, maxLines = 8): number {
  for (const s of TIME_STEPS_MS) if (xspan / s <= maxLines) return s;
  return TIME_STEPS_MS[TIME_STEPS_MS.length - 1];
}

export function fmtTimeHM(ms: number, tz: TimezoneId): string {
  const { h, mi } = zonedParts(ms, tz);
  const p = (z: number) => String(z).padStart(2, "0");
  return `${p(h)}:${p(mi)}`;
}

export function fmtDateDM(ms: number, tz: TimezoneId): string {
  const { d, mo } = zonedParts(ms, tz);
  const p = (z: number) => String(z).padStart(2, "0");
  return `${p(d)}.${p(mo + 1)}`;
}

export function dayKey(ms: number, tz: TimezoneId): number {
  const { y, mo, d } = zonedParts(ms, tz);
  return y * 10000 + mo * 100 + d;
}

/** Horizontal price gridlines + right-side price axis labels. */
export function drawPriceGrid(
  ctx: CanvasRenderingContext2D,
  layout: PlotLayout,
  yMin: number,
  yMax: number,
  sy: (p: number) => number,
) {
  const { plotX, plotW, plotH } = layout;
  ctx.font = "10px ui-sans-serif, system-ui";
  ctx.textAlign = "left";
  const yspan = yMax - yMin || 1;
  const priceStep = niceStep(yspan / 6);
  const priceStart = Math.ceil(yMin / priceStep) * priceStep;
  for (let price = priceStart; price <= yMax; price += priceStep) {
    const y = sy(price);
    if (y < 0 || y > plotH) continue;
    ctx.strokeStyle = CHART_COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(plotX, y);
    ctx.lineTo(plotX + plotW, y);
    ctx.stroke();
    ctx.fillStyle = CHART_COLORS.axisText;
    ctx.fillText(fmtPriceLabel(price), plotX + plotW + 5, Math.min(plotH - 2, Math.max(9, y + 3)));
  }
}

/** Vertical time gridlines + bottom time axis labels, timezone-aware. */
export function drawTimeGrid(
  ctx: CanvasRenderingContext2D,
  layout: PlotLayout,
  t0: number,
  t1: number,
  timezone: TimezoneId,
  sx: (ms: number) => number,
) {
  const { plotX, plotW, plotH, H } = layout;
  const xspan = t1 - t0 || 1;
  const timeStep = niceTimeStep(xspan);
  const timeStart = Math.ceil(t0 / timeStep) * timeStep;
  ctx.textAlign = "center";
  let lastDay: number | null = null;
  for (let ms = timeStart; ms <= t1; ms += timeStep) {
    const x = sx(ms);
    if (x < plotX || x > plotX + plotW) continue;
    ctx.strokeStyle = CHART_COLORS.gridWeak;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, plotH);
    ctx.stroke();
    const day = dayKey(ms, timezone);
    const isDayStep = timeStep >= 86400000;
    const isNewDay = day !== lastDay;
    lastDay = day;
    const label = isDayStep
      ? fmtDateDM(ms, timezone)
      : isNewDay
        ? `${fmtDateDM(ms, timezone)} ${fmtTimeHM(ms, timezone)}`
        : fmtTimeHM(ms, timezone);
    ctx.fillStyle = isDayStep || isNewDay ? CHART_COLORS.axisTextStrong : CHART_COLORS.axisTextWeak;
    ctx.fillText(label, x, H - 6);
  }
  ctx.textAlign = "left";
}

/** Candle wicks + bodies. */
export function drawCandlesticks(
  ctx: CanvasRenderingContext2D,
  candles: Candle[],
  sx: (ms: number) => number,
  sy: (p: number) => number,
  plotX: number,
  plotW: number,
  xspan: number,
  opts: { clusters?: boolean; colW?: number; bodyRatio?: number } = {},
) {
  if (candles.length < 2) return;
  const stepMs = candles[1].t - candles[0].t;
  const clusters = !!opts.clusters;
  const colW = opts.colW ?? 0;
  const bodyRatio = opts.bodyRatio ?? 0.7;
  const wickW = clusters
    ? Math.min(3, Math.max(1, (stepMs / xspan) * plotW * 0.05))
    : 1;
  const cw = clusters
    ? wickW * 3
    : Math.max(1, (stepMs / xspan) * plotW * bodyRatio);
  ctx.lineWidth = wickW;
  for (const k of candles) {
    const x = sx(k.t + stepMs / 2);
    if (x < plotX - colW - 2 || x > plotX + plotW + colW + 2) continue;
    const up = k.c >= k.o;
    ctx.strokeStyle = up ? CHART_COLORS.up : CHART_COLORS.down;
    ctx.fillStyle = up ? CHART_COLORS.up : CHART_COLORS.down;
    ctx.beginPath();
    ctx.moveTo(x, sy(k.h));
    ctx.lineTo(x, sy(k.l));
    ctx.stroke();
    const yo = sy(k.o);
    const yc = sy(k.c);
    const bodyX = clusters ? x - cw - 1 : x - cw / 2;
    ctx.fillRect(bodyX, Math.min(yo, yc), cw, Math.max(1, Math.abs(yc - yo)));
  }
  ctx.lineWidth = 1;
}

/**
 * Вертикальная граница "начало истории данных" — рисуется вместо тихой
 * пустоты слева, когда догрузка истории (lazy-loading, см. LAZY_HISTORY_PLAN.md)
 * упёрлась в реальный край данных в БД. `x` — экранная координата самой
 * старой загруженной свечи; рисуется, только если она попадает в plot area.
 */
export function drawHistoryStartBoundary(
  ctx: CanvasRenderingContext2D,
  x: number,
  layout: PlotLayout,
  label: string,
) {
  const { plotX, plotW, plotH } = layout;
  if (x < plotX - 1 || x > plotX + plotW + 1) return;
  ctx.save();
  ctx.strokeStyle = CHART_COLORS.gridWeak;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, plotH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "11px ui-sans-serif, system-ui";
  ctx.fillStyle = CHART_COLORS.axisTextWeak;
  ctx.textAlign = "left";
  ctx.save();
  ctx.translate(x + 4, plotH - 6);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(label, 0, 0);
  ctx.restore();
  ctx.restore();
}

/** Dashed crosshair lines at (cx, cy) within the plot area. */
export function drawCrosshair(ctx: CanvasRenderingContext2D, cx: number, cy: number, layout: PlotLayout) {
  const { plotX, plotW, plotH } = layout;
  ctx.strokeStyle = CHART_COLORS.crosshair;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, plotH);
  ctx.moveTo(plotX, cy);
  ctx.lineTo(plotX + plotW, cy);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Dashed horizontal line at the last close price + price tag on the right axis. */
export function drawLastPriceTag(
  ctx: CanvasRenderingContext2D,
  price: number,
  yp: number,
  layout: PlotLayout,
) {
  const { plotX, plotW, plotH } = layout;
  if (yp < 0 || yp > plotH) return;
  ctx.strokeStyle = CHART_COLORS.accent;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(plotX, yp);
  ctx.lineTo(plotX + plotW, yp);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = CHART_COLORS.accent;
  ctx.fillRect(plotX + plotW, yp - 7, PADR, 14);
  ctx.fillStyle = "#08080d";
  ctx.fillText(fmtPriceLabel(price), plotX + plotW + 5, yp + 3);
}

/** Price tag on the right axis that follows the crosshair. */
export function drawPriceCrosshairTag(ctx: CanvasRenderingContext2D, priceH: number, cy: number, layout: PlotLayout) {
  const { plotX, plotW } = layout;
  ctx.fillStyle = CHART_COLORS.accent;
  ctx.fillRect(plotX + plotW, cy - 7, PADR, 14);
  ctx.fillStyle = "#08080d";
  ctx.fillText(fmtPriceLabel(priceH), plotX + plotW + 5, cy + 3);
}

/** Time tag on the bottom axis that follows the crosshair. */
export function drawTimeCrosshairTag(ctx: CanvasRenderingContext2D, label: string, cx: number, layout: PlotLayout) {
  const { plotX, plotW, plotH, H } = layout;
  ctx.font = "11px ui-sans-serif, system-ui";
  ctx.textAlign = "center";
  const timeBoxW = Math.ceil(ctx.measureText(label).width) + 12;
  const timeBoxX = Math.min(plotX + plotW - timeBoxW / 2, Math.max(plotX + timeBoxW / 2, cx));
  ctx.fillStyle = CHART_COLORS.accent;
  ctx.fillRect(timeBoxX - timeBoxW / 2, plotH, timeBoxW, PADB - 1);
  ctx.fillStyle = "#08080d";
  ctx.fillText(label, timeBoxX, H - 6);
  ctx.textAlign = "left";
}

/** Floating info box (OHLC / wall / etc.) anchored near the cursor. */
export function drawTooltipBox(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  cx: number,
  cy: number,
  layout: PlotLayout,
) {
  const tipPx = 14;
  const lineH = 20;
  const padX = 12;
  const padY = 10;
  ctx.font = `${tipPx}px ui-sans-serif, system-ui`;
  let textW = 0;
  for (const ln of lines) textW = Math.max(textW, ctx.measureText(ln).width);
  const boxW = Math.ceil(textW) + padX * 2;
  const boxH = padY * 2 + lines.length * lineH;
  let bx = cx + 16;
  let by = cy + 16;
  if (bx + boxW > layout.plotX + layout.plotW) bx = cx - boxW - 16;
  if (by + boxH > layout.plotH) by = cy - boxH - 16;
  ctx.fillStyle = CHART_COLORS.tooltipBg;
  ctx.strokeStyle = CHART_COLORS.tooltipBorder;
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.strokeRect(bx, by, boxW, boxH);
  ctx.textBaseline = "middle";
  ctx.fillStyle = CHART_COLORS.tooltipText;
  lines.forEach((ln, i) => ctx.fillText(ln, bx + padX, by + padY + lineH / 2 + i * lineH));
  ctx.textBaseline = "alphabetic";
}

/** Initial (t0..t1, y0..y1) view window: last `visibleCount` candles, padded 4% vertically. */
export function computeInitialView(candles: Candle[], from: number, to: number, visibleCount: number) {
  const step = candles.length > 1 ? candles[1].t - candles[0].t : (to - from) / 40 || 60000;
  const t0 = Math.max(from, to - visibleCount * step);
  let vy0 = Infinity;
  let vy1 = -Infinity;
  for (const k of candles) {
    if (k.t < t0) continue;
    if (k.l < vy0) vy0 = k.l;
    if (k.h > vy1) vy1 = k.h;
  }
  if (!Number.isFinite(vy0) || !Number.isFinite(vy1)) {
    vy0 = Math.min(...candles.map((k) => k.l), 0);
    vy1 = Math.max(...candles.map((k) => k.h), 1);
  }
  const pad = (vy1 - vy0) * 0.04 || vy1 * 0.01;
  return { t0, t1: to, y0: vy0 - pad, y1: vy1 + pad };
}

/** Delta histogram (top/bottom of midline) + CVD line overlay, with axis labels. */
export function drawDeltaCvdChart(
  ctx: CanvasRenderingContext2D,
  opts: {
    W: number;
    H: number;
    t0: number;
    t1: number;
    times: number[];
    delta: number[];
    cvd?: number[] | null;
    emptyText: string;
  },
) {
  const { W, H, t0, t1, times, delta, cvd, emptyText } = opts;
  ctx.fillStyle = CHART_COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  const plotX = PADL + PRICE_AXIS_W;
  const plotW = W - plotX - PADR;
  if (!delta.length) {
    ctx.fillStyle = CHART_COLORS.axisTextWeak;
    ctx.font = "11px ui-sans-serif, system-ui";
    ctx.fillText(emptyText, plotX, H / 2);
    return;
  }
  const xspan = t1 - t0 || 1;
  const sx = (ms: number) => plotX + ((ms - t0) / xspan) * plotW;

  const n = delta.length;
  const maxAbs = Math.max(1, ...delta.map((v) => Math.abs(v)));
  const mid = H / 2;
  const bw = Math.max(1, (plotW / n) * 0.8);
  for (let i = 0; i < n; i++) {
    const v = delta[i];
    if (v === 0) continue;
    const x = sx(times[i]);
    const h = (Math.abs(v) / maxAbs) * (H / 2 - 4);
    ctx.fillStyle = v >= 0 ? "rgba(22,199,132,0.8)" : "rgba(234,57,67,0.8)";
    if (v >= 0) ctx.fillRect(x - bw / 2, mid - h, bw, h);
    else ctx.fillRect(x - bw / 2, mid, bw, h);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(plotX, mid);
  ctx.lineTo(plotX + plotW, mid);
  ctx.stroke();

  ctx.fillStyle = CHART_COLORS.axisText;
  ctx.font = "12px ui-sans-serif, system-ui";
  ctx.fillText("Δ / CVD", plotX + 2, 13);

  if (cvd && cvd.length === n) {
    const cvdMin = Math.min(...cvd);
    const cvdMax = Math.max(...cvd);
    const cspan = cvdMax - cvdMin || 1;
    const cy = (v: number) => H - 4 - ((v - cvdMin) / cspan) * (H - 8);
    ctx.strokeStyle = CHART_COLORS.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = sx(times[i]);
      const y = cy(cvd[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;

    ctx.fillStyle = CHART_COLORS.accent;
    ctx.fillText(`CVD ${cvd[n - 1] >= 0 ? "+" : "-"}${fmtValLabel(Math.abs(cvd[n - 1]))}`, plotX + plotW + 5, 13);
  }
}

/** Two-line time series over a shaded band (e.g. bid/ask), with axis legend. */
export function drawTwoLineSeries(
  ctx: CanvasRenderingContext2D,
  opts: {
    W: number;
    H: number;
    t0: number;
    t1: number;
    times: number[];
    a: number[];
    b: number[];
    colorA: string;
    colorB: string;
    labelA: string;
    labelB: string;
    title: string;
    emptyText: string;
    yDomain?: [number, number];
    fillBand?: boolean;
  },
) {
  const { W, H, t0, t1, times, a, b, colorA, colorB, labelA, labelB, title, emptyText, fillBand } = opts;
  ctx.fillStyle = CHART_COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  const plotX = PADL + PRICE_AXIS_W;
  const plotW = W - plotX - PADR;
  if (!a.length) {
    ctx.fillStyle = CHART_COLORS.axisTextWeak;
    ctx.font = "11px ui-sans-serif, system-ui";
    ctx.fillText(emptyText, plotX, H / 2);
    return;
  }
  const xspan = t1 - t0 || 1;
  const sx = (ms: number) => plotX + ((ms - t0) / xspan) * plotW;

  const [yMin, yMax] = opts.yDomain ?? (() => {
    const all = [...a, ...b];
    return [Math.min(...all), Math.max(...all)] as [number, number];
  })();
  const yspan = yMax - yMin || 1;
  const sy = (v: number) => H - 4 - ((v - yMin) / yspan) * (H - 8);

  if (fillBand) {
    ctx.beginPath();
    ctx.moveTo(sx(times[0]), sy(a[0]));
    for (let i = 1; i < a.length; i++) ctx.lineTo(sx(times[i]), sy(a[i]));
    for (let i = b.length - 1; i >= 0; i--) ctx.lineTo(sx(times[i]), sy(b[i]));
    ctx.closePath();
    ctx.fillStyle = "rgba(22,199,132,0.08)";
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(plotX, sy((yMin + yMax) / 2));
  ctx.lineTo(plotX + plotW, sy((yMin + yMax) / 2));
  ctx.stroke();

  const line = (vals: number[], color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < vals.length; i++) {
      const x = sx(times[i]);
      const y = sy(vals[i]);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  };
  line(a, colorA);
  line(b, colorB);

  ctx.font = "10px ui-sans-serif, system-ui";
  ctx.fillStyle = CHART_COLORS.axisText;
  ctx.fillText(title, plotX + 2, 12);
  ctx.fillStyle = colorA;
  ctx.fillText(labelA, plotX + plotW + 5, 12);
  ctx.fillStyle = colorB;
  ctx.fillText(labelB, plotX + plotW + 5, 24);
}
