// Подсветка торговых сессий на свечном графике: прямоугольник по диапазону
// цены сессии + подпись под ним (как «Sessions» в TradingView).
//
// Коробка строится по хай/лоу свечей, попавших в окно сессии, а не на всю
// высоту графика: так видно, какой диапазон рынок прошёл именно в эту сессию,
// и подсветка не заливает половину экрана.
//
// Рисуется ПОД свечами — это фон, а не оверлей.

import type { Candle, PlotLayout } from "./candlestickChart";
import type { SessionWindow } from "./tradingSessions";

/** Уже коробки подпись не влезает и превращается в кашу — не рисуем её. */
const MIN_LABEL_WIDTH = 44;
/** Шаг, на который сдвигается подпись, если она налезла на соседнюю. */
const LABEL_ROW_H = 12;
/** Совсем узкие коробки (сессия почти за краем экрана) не рисуем вовсе. */
const MIN_BOX_WIDTH = 2;
const LABEL_OFFSET = 13;

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function drawSessionBoxes(
  ctx: CanvasRenderingContext2D,
  windows: SessionWindow[],
  candles: Candle[],
  sx: (ms: number) => number,
  sy: (price: number) => number,
  layout: PlotLayout,
): void {
  if (windows.length === 0 || candles.length === 0) return;

  const { plotX, plotW, plotH } = layout;
  const right = plotX + plotW;

  // Шаг свечи — на него продлевается коробка идущей сессии, чтобы последняя
  // свеча не торчала из неё.
  const barMs = candles.length > 1 ? candles[1].t - candles[0].t : 60_000;
  // Подписи не должны налезать друг на друга: сессии перекрываются во времени
  // (Лондон и Нью-Йорк — на четыре часа), и их коробки часто заканчиваются на
  // близких минимумах.
  const placed: { x0: number; x1: number; y: number }[] = [];

  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.font = "10px ui-sans-serif, system-ui";
  ctx.textBaseline = "middle";

  for (const w of windows) {
    const rawX0 = sx(w.start);
    const rawX1 = sx(w.end);
    if (rawX1 <= plotX || rawX0 >= right) continue;

    // Хай/лоу считаем по свечам сессии — по ним и строится коробка.
    let hi = -Infinity;
    let lo = Infinity;
    let lastT = -Infinity;
    for (const c of candles) {
      if (c.t < w.start || c.t >= w.end) continue;
      if (c.h > hi) hi = c.h;
      if (c.l < lo) lo = c.l;
      if (c.t > lastT) lastT = c.t;
    }
    if (hi === -Infinity || lo === Infinity) continue; // данных за сессию нет

    // Идущая сессия не должна тянуться в будущее: коробка растёт вместе с
    // рынком и заканчивается на последней свече, а не на времени закрытия.
    const grownEnd = Math.min(rawX1, sx(lastT + barMs));
    const x0 = Math.max(plotX, rawX0);
    const x1 = Math.min(right, Math.max(grownEnd, rawX0 + MIN_BOX_WIDTH));
    const boxW = x1 - x0;
    if (boxW < MIN_BOX_WIDTH) continue;

    // Небольшой воздух сверху/снизу, чтобы свечи не липли к рамке.
    const y0 = Math.max(0, sy(hi) - 3);
    const y1 = Math.min(plotH, sy(lo) + 3);
    const boxH = y1 - y0;
    if (boxH <= 0) continue;

    ctx.fillStyle = withAlpha(w.color, 0.12);
    ctx.fillRect(x0, y0, boxW, boxH);
    ctx.strokeStyle = withAlpha(w.color, 0.38);
    // Полупиксельный сдвиг — иначе рамка в 1px размазывается на два.
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, boxW - 1, boxH - 1);

    if (boxW < MIN_LABEL_WIDTH) continue;
    // Подпись под коробкой; если та у самого низа — переносим внутрь, иначе
    // текст уедет под ось времени.
    let labelY = y1 + LABEL_OFFSET <= plotH - 2 ? y1 + LABEL_OFFSET : Math.max(y0 + 8, y1 - 8);
    ctx.textAlign = "center";
    const cx = Math.min(right - 4, Math.max(plotX + 4, (x0 + x1) / 2));
    const halfText = ctx.measureText(w.label).width / 2 + 4;
    const lx0 = cx - halfText;
    const lx1 = cx + halfText;
    // Пока подпись пересекается с уже нарисованной — опускаем на строку ниже.
    for (let guard = 0; guard < 4; guard++) {
      const clash = placed.some((p) => Math.abs(p.y - labelY) < LABEL_ROW_H && p.x1 > lx0 && p.x0 < lx1);
      if (!clash) break;
      labelY += LABEL_ROW_H;
    }
    if (labelY > plotH - 2) labelY = Math.max(y0 + 8, y1 - 8);
    placed.push({ x0: lx0, x1: lx1, y: labelY });
    ctx.fillStyle = withAlpha(w.color, 0.95);
    ctx.fillText(w.label, cx, labelY);
  }

  ctx.restore();
}
