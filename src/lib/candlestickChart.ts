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
  // Цвет рисунков по умолчанию (трендовые, уровни, прямоугольники) и их
  // черновика под курсором. Отдельно от accent намеренно: жёлтым идёт линия
  // текущей цены, и нарисованный уровень сливался с ней — на графике с
  // несколькими своими уровнями было не понять, где цена, а где разметка.
  // Голубой не занят ничем другим: свечи зелёные/красные, POC зелёный,
  // карта лимиток серая.
  drawing: "#38bdf8",
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

// ─── Ось времени со сжатием неторговых промежутков ────────────────────────
//
// Крипта торгуется 24/7, а форекс — нет: с вечера пятницы до утра понедельника
// свечей просто не существует. Если откладывать время по оси линейно, каждые
// выходные превращаются в пустую вертикальную полосу шириной в треть недели, и
// график недели за неделей рвётся на куски.
//
// Поэтому ось работает в «торговом времени»: промежутки, где свечей нет,
// схлопываются в ноль — ровно так же ведут себя биржевые терминалы. Все
// координатные функции (свечи, сетка, рисунки, метки дивергенций, курсор)
// ходят через одну и ту же пару compress/expand, иначе слои разъедутся.
//
// Для 24/7-инструментов список пропусков пуст, compress/expand становятся
// тождественными, и поведение графика не меняется вообще (см. LINEAR_TIME_AXIS).
export type TimeAxis = {
  /** Реальное время → «торговое» (без неторговых промежутков). */
  compress: (ms: number) => number;
  /** Обратно: «торговое» время → реальное. */
  expand: (compressed: number) => number;
};

export const LINEAR_TIME_AXIS: TimeAxis = { compress: (ms) => ms, expand: (c) => c };

// Во сколько раз разрыв между соседними свечами должен превышать таймфрейм,
// чтобы считаться неторговым промежутком. 1.5 = схлопывается любая дырка от
// одной пропущенной свечи и больше.
//
// Почему так агрессивно: на форексе отсутствие свечи означает «не было ни
// одного тика», а не потерю данных — ночью по золоту таких минут десятки за
// сессию. Оставлять под них пустое место незачем, биржевые терминалы этого и
// не делают: там ось вообще нумерует бары, а не время.
const GAP_THRESHOLD_RATIO = 1.5;

/**
 * Строит ось по фактическому ряду свечей: всё, что между ними пропущено
 * дольше полутора таймфреймов, считается неторговым временем.
 */
export function buildTimeAxis(candles: Candle[], stepMs: number): TimeAxis {
  if (candles.length < 2 || !Number.isFinite(stepMs) || stepMs <= 0) return LINEAR_TIME_AXIS;

  // starts/ends — границы пропусков в реальном времени, cumulative[i] — сколько
  // времени вырезано ДО i-го пропуска (префиксные суммы, чтобы compress не
  // бегал по всему списку на каждый вызов: за кадр их десятки тысяч).
  const starts: number[] = [];
  const ends: number[] = [];
  const cumulative: number[] = [];
  let removed = 0;
  for (let i = 1; i < candles.length; i++) {
    const prevEnd = candles[i - 1].t + stepMs;
    const next = candles[i].t;
    if (next - candles[i - 1].t <= stepMs * GAP_THRESHOLD_RATIO) continue;
    starts.push(prevEnd);
    ends.push(next);
    cumulative.push(removed);
    removed += next - prevEnd;
  }
  if (starts.length === 0) return LINEAR_TIME_AXIS;

  // Сжатые координаты начал пропусков — для обратного преобразования.
  const compressedStarts = starts.map((s, i) => s - cumulative[i]);

  /** Индекс последнего пропуска, начавшегося не позже value (или -1). */
  const lastIndexAtOrBefore = (arr: number[], value: number) => {
    let lo = 0;
    let hi = arr.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= value) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return found;
  };

  return {
    compress(ms: number) {
      const i = lastIndexAtOrBefore(starts, ms);
      if (i < 0) return ms;
      // Точка внутри пропуска схлопывается на его начало — иначе курсор и
      // рисунки, попавшие на выходные, «уезжали» бы вправо на ширину разрыва.
      const inside = ms < ends[i];
      const cut = cumulative[i] + (inside ? ms - starts[i] : ends[i] - starts[i]);
      return ms - cut;
    },
    expand(compressed: number) {
      const i = lastIndexAtOrBefore(compressedStarts, compressed);
      if (i < 0) return compressed;
      return compressed + cumulative[i] + (ends[i] - starts[i]);
    },
  };
}

/**
 * Проекция «время → X» и обратная к ней для окна [t0, t1] на ширине plotW.
 * Обе стороны обязаны строиться отсюда: рассинхрон прямого и обратного
 * преобразования проявляется как курсор, который не попадает в свечу.
 */
export function makeTimeProjection(axis: TimeAxis, t0: number, t1: number, plotX: number, plotW: number) {
  const c0 = axis.compress(t0);
  const cspan = axis.compress(t1) - c0 || 1;
  return {
    /** Ширина окна в «торговом» времени — её же ждёт drawCandlesticks. */
    cspan,
    sx: (ms: number) => plotX + ((axis.compress(ms) - c0) / cspan) * plotW,
    invX: (x: number) => axis.expand(c0 + ((x - plotX) / plotW) * cspan),
  };
}

export function computePlotLayout(W: number, H: number, padBottom = PADB): PlotLayout {
  const plotX = PADL + PRICE_AXIS_W;
  const plotW = W - plotX - PADR;
  const plotH = H - padBottom;
  return { plotX, plotW, plotH, W, H };
}

export function fmtPriceLabel(p: number): string {
  const a = Math.abs(p);
  if (a >= 1000) return Math.round(p).toLocaleString("en-US");
  if (a >= 10) return p.toFixed(2);
  // Валютные мажоры (0.6–1.5) двумя знаками превращались в «1.17» — на
  // форексе это 7 пунктов, то есть подпись цены становилась бесполезной.
  if (a >= 1) return p.toFixed(5);
  return p.toPrecision(4);
}

/** Достаточно ли цвет тёмный, чтобы писать по нему светлым. */
function isDarkColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Стандартная относительная яркость: тёмный фон → светлый текст.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.55;
}

/** Ярлык с ценой на правой шкале произвольного цвета (уровни пользователя). */
export function drawAxisPriceTag(
  ctx: CanvasRenderingContext2D,
  price: number,
  y: number,
  layout: PlotLayout,
  color: string,
) {
  const { plotX, plotW, plotH } = layout;
  if (y < 0 || y > plotH) return;
  const cy = Math.min(plotH - 7, Math.max(7, y));
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.fillRect(plotX + plotW, cy - 7, PADR, 14);
  ctx.fillStyle = isDarkColor(color) ? "#f5f5f7" : "#08080d";
  ctx.font = "10px ui-sans-serif, system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(fmtPriceLabel(price), plotX + plotW + 5, cy + 3);
  ctx.restore();
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
// Плотность сетки считаем от размера полотна, а не фиксированным числом линий.
// Раньше было «8 вертикалей и 6 горизонталей» на любой экран: на развёрнутом
// во весь экран графике это одна линия на четверть ширины — на минутном
// таймфрейме сетка выглядела пустой, подписи шли через полчаса. Привязка к
// пикселям делает её вдвое гуще на большом экране и при этом не склеивает
// подписи на узком (там линий становится меньше, а не больше).
//
// Числа — это минимальный просвет между линиями в CSS-пикселях: подпись
// времени «17:05» при 10px шрифте занимает ~30px, ценовая — ~12px по высоте.
const TIME_GRID_PX = 70;
const PRICE_GRID_PX = 48;

/** Сколько линий сетки уместится по одной оси, с потолком и полом. */
export function gridLineCount(sizePx: number, perLinePx: number, min: number, max: number): number {
  if (!Number.isFinite(sizePx) || sizePx <= 0) return min;
  return Math.max(min, Math.min(max, Math.round(sizePx / perLinePx)));
}

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
  const priceStep = niceStep(yspan / gridLineCount(plotH, PRICE_GRID_PX, 3, 24));
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
  axis: TimeAxis = LINEAR_TIME_AXIS,
) {
  const { plotX, plotW, plotH, H } = layout;
  // Шаг сетки берётся в «торговом» времени и там же откладывается: иначе на
  // сжатой оси линии сгущались бы к выходным, а внутри схлопнутого промежутка
  // несколько подписей легли бы друг на друга в одной точке.
  const c0 = axis.compress(t0);
  const c1 = axis.compress(t1);
  const xspan = c1 - c0 || 1;
  const timeStep = niceTimeStep(xspan, gridLineCount(plotW, TIME_GRID_PX, 3, 20));
  const timeStart = Math.ceil(c0 / timeStep) * timeStep;
  ctx.textAlign = "center";
  let lastDay: number | null = null;
  for (let cms = timeStart; cms <= c1; cms += timeStep) {
    const ms = axis.expand(cms);
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
export function computeInitialView(
  candles: Candle[],
  from: number,
  to: number,
  visibleCount: number,
  axis: TimeAxis = LINEAR_TIME_AXIS,
) {
  const step = candles.length > 1 ? candles[1].t - candles[0].t : (to - from) / 40 || 60000;
  // Отступаем назад в «торговом» времени: на линейной оси окно шириной
  // visibleCount * step вмещало бы меньше свечей, чем просили, ровно на
  // длину попавших в него выходных.
  const t0 = Math.max(from, axis.expand(axis.compress(to) - visibleCount * step));
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
    /** Та же ось, что у основного графика — иначе панель разъедется с ним по X. */
    axis?: TimeAxis;
  },
) {
  const { W, H, t0, t1, times, delta, cvd, emptyText, axis = LINEAR_TIME_AXIS } = opts;
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
  const { sx } = makeTimeProjection(axis, t0, t1, plotX, plotW);

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
    /** Та же ось, что у основного графика — иначе панель разъедется с ним по X. */
    axis?: TimeAxis;
  },
) {
  const { W, H, t0, t1, times, a, b, colorA, colorB, labelA, labelB, title, emptyText, fillBand, axis = LINEAR_TIME_AXIS } = opts;
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
  const { sx } = makeTimeProjection(axis, t0, t1, plotX, plotW);

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
