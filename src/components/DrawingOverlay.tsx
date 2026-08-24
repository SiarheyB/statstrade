/**
 * DrawingOverlay — pure function для отрисовки инструментов рисования на canvas.
 * + утилиты для поиска рисунка под курсором.
 *
 * Поддерживает: trend_line, horizontal_line, horizontal_ray, rectangle.
 */

import type { DrawingRow, DrawingPoint, DrawingToolType } from "@/lib/drawings";
import { drawAxisPriceTag, fmtPriceLabel, type Candle, type PlotLayout } from "@/lib/candlestickChart";

// ─── Rendering ───────────────────────────────────────────────────────────────

/** Сторона короче — середину не показываем: маркер слипается с угловыми и
 *  попасть в него мышью всё равно нельзя. */
const MID_HANDLE_MIN_SIDE = 24; // px

/** Ручки в серединах сторон прямоугольника, в порядке индексов 4..7:
 *  [левая, правая, верхняя, нижняя]. null — сторона слишком короткая. */
function rectMidHandles(
  x0: number, y0: number, x1: number, y1: number,
): Array<{ x: number; y: number } | null> {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const tallEnough = y1 - y0 >= MID_HANDLE_MIN_SIDE;
  const wideEnough = x1 - x0 >= MID_HANDLE_MIN_SIDE;
  return [
    tallEnough ? { x: x0, y: cy } : null,
    tallEnough ? { x: x1, y: cy } : null,
    wideEnough ? { x: cx, y: y0 } : null,
    wideEnough ? { x: cx, y: y1 } : null,
  ];
}

/** Нарисовать все рисунки на canvas. */
export function drawDrawings(
  ctx: CanvasRenderingContext2D,
  sx: (ms: number) => number,
  sy: (price: number) => number,
  plotX: number,
  plotW: number,
  plotH: number,
  drawings: DrawingRow[],
  selectedId: string | null,
  /** Нужен, чтобы нарисовать ярлык цены на правой шкале — она лежит ЗА
   *  областью графика, а сама отрисовка рисунков обрезана по ней. */
  layout?: PlotLayout,
  /** Свечи нужны, чтобы решить, с какой стороны линии писать цену: уровень
   *  по хаю подписываем сверху, по лоу — снизу (см. priceLabelSide). */
  candles?: Candle[],
): void {
  if (!drawings.length) return;

  // Ярлыки цены собираем по ходу дела и рисуем после снятия клипа: внутри
  // clip() всё, что правее графика, просто не видно.
  const priceTags: { price: number; y: number; color: string }[] = [];

  ctx.save();
  ctx.beginPath();
  ctx.rect(plotX, 0, plotW, plotH);
  ctx.clip();

  for (const d of drawings) {
    // Validate d.points before attempting to parse
    if (!d.points || typeof d.points !== 'string') {
      continue;
    }

    let pts: DrawingPoint[];
    try {
      pts = JSON.parse(d.points);
      // Validate that pts is an array of DrawingPoint objects
      if (!Array.isArray(pts) || pts.length === 0) {
        continue;
      }
    } catch {
      // If JSON parsing fails, skip this drawing
      continue;
    }

    const isSelected = d.id === selectedId;
    const color = d.color;
    const lw = d.lineWidth;

    // Конвертируем точки в экранные координаты
    const screenPts = pts.map((p) => ({
      x: sx(p.t),
      y: sy(p.price),
    }));

    // Пропускаем, если рисунок целиком за пределами экрана.
    // Для горизонтальных инструментов проверяем только Y — линия идёт на всю ширину графика.
    // Для линии/прямоугольника сравниваем bounding box точек с областью графика —
    // если проверять "офскрин" каждую точку по отдельности, линия с концами
    // за разными краями экрана (но проходящая через видимую середину) ложно скрывается.
    let allOffscreen: boolean;
    if (d.toolType === "horizontal_line" || d.toolType === "horizontal_ray") {
      allOffscreen = screenPts[0].y < 0 || screenPts[0].y > plotH;
    } else {
      const minX = Math.min(...screenPts.map((p) => p.x));
      const maxX = Math.max(...screenPts.map((p) => p.x));
      const minY = Math.min(...screenPts.map((p) => p.y));
      const maxY = Math.max(...screenPts.map((p) => p.y));
      allOffscreen = maxX < plotX || minX > plotX + plotW || maxY < 0 || minY > plotH;
    }
    if (allOffscreen) continue;

    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? lw + 2 : lw;
    ctx.globalAlpha = isSelected ? 1 : 0.8;
    ctx.setLineDash([]);

    switch (d.toolType) {
      case "trend_line": {
        if (screenPts.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(screenPts[0].x, screenPts[0].y);
        ctx.lineTo(screenPts[1].x, screenPts[1].y);
        ctx.stroke();
        // Маркеры на концах
        drawHandle(ctx, screenPts[0].x, screenPts[0].y, color, isSelected);
        drawHandle(ctx, screenPts[1].x, screenPts[1].y, color, isSelected);
        break;
      }
      case "horizontal_line": {
        const y = screenPts[0].y;
        if (y < 0 || y > plotH) break;
        ctx.beginPath();
        ctx.moveTo(plotX, y);
        ctx.lineTo(plotX + plotW, y);
        ctx.stroke();
        drawHandle(ctx, plotX, y, color, isSelected);
        drawHandle(ctx, plotX + plotW, y, color, isSelected);
        if (d.showPrice !== false) {
          priceTags.push({ price: pts[0].price, y, color });
          drawPriceChip(ctx, plotX + 6, y, pts[0].price, color, priceLabelSide(pts[0].price, y, plotH, candles, sx, plotX, plotW), plotX, plotW);
        }
        break;
      }
      case "horizontal_ray": {
        const ry = screenPts[0].y;
        const rx = screenPts[0].x;
        if (ry < 0 || ry > plotH) break;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(plotX + plotW, ry);
        ctx.stroke();
        // Стрелка вправо
        ctx.beginPath();
        ctx.moveTo(plotX + plotW, ry);
        ctx.lineTo(plotX + plotW - 8, ry - 4);
        ctx.lineTo(plotX + plotW - 8, ry + 4);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        drawHandle(ctx, rx, ry, color, isSelected);
        if (d.showPrice !== false) {
          priceTags.push({ price: pts[0].price, y: ry, color });
          // Луч идёт вправо от точки — там же, чуть правее якоря, и подпись.
          drawPriceChip(ctx, rx + 8, ry, pts[0].price, color, priceLabelSide(pts[0].price, ry, plotH, candles, sx, plotX, plotW), plotX, plotW);
        }
        break;
      }
      case "rectangle": {
        if (screenPts.length < 2) break;
        const x0 = Math.min(screenPts[0].x, screenPts[1].x);
        const x1 = Math.max(screenPts[0].x, screenPts[1].x);
        const y0 = Math.min(screenPts[0].y, screenPts[1].y);
        const y1 = Math.max(screenPts[0].y, screenPts[1].y);
        // Схлопнутый в линию прямоугольник (тянули грань до противоположной)
        // всё равно рисуем: иначе фигура пропадает с экрана и пользователь не
        // может её ни увидеть, ни разжать обратно.
        const w = Math.max(x1 - x0, 1);
        const h = Math.max(y1 - y0, 1);
        // Заливка
        if (d.fillColor) {
          ctx.fillStyle = d.fillColor;
          ctx.globalAlpha = 0.15;
          ctx.fillRect(x0, y0, w, h);
          ctx.globalAlpha = isSelected ? 1 : 0.8;
        }
        // Контур
        ctx.strokeRect(x0, y0, w, h);
        // Маркеры по углам
        drawHandle(ctx, x0, y0, color, isSelected);
        drawHandle(ctx, x1, y0, color, isSelected);
        drawHandle(ctx, x0, y1, color, isSelected);
        drawHandle(ctx, x1, y1, color, isSelected);
        // Маркеры в серединах сторон (как в TradingView): тянут ровно одну
        // грань — боковые меняют только время, верхний/нижний только цену.
        // На коротких сторонах не рисуем: маркер слипся бы с угловыми.
        for (const m of rectMidHandles(x0, y0, x1, y1)) {
          if (m) drawHandle(ctx, m.x, m.y, color, isSelected);
        }
        break;
      }
    }
  }

  ctx.restore();

  // Ярлык цены — той же расцветки, что и сам уровень: так на шкале сразу
  // видно, какому уровню какая цена принадлежит.
  if (layout) {
    for (const tag of priceTags) drawAxisPriceTag(ctx, tag.price, tag.y, layout, tag.color);
  }
}

/** С какой стороны линии писать цену.
 *
 * Раньше подпись всегда висела над точкой и налезала то на свечи, то на
 * маркеры сигналов — прочитать её было нельзя. Правило простое и совпадает
 * с тем, как уровни ставят руками: если ценовое движение в основном НИЖЕ
 * уровня (уровень провели по хаю — сопротивление), подпись уходит вверх, в
 * пустоту; если выше (уровень по лоу — поддержка) — вниз.
 *
 * Свечи берём только видимые: загружено может быть куда больше, чем сейчас
 * на экране, и уехавшая история перетянула бы решение на себя.
 */
export function priceLabelSide(
  price: number,
  y: number,
  plotH: number,
  candles: Candle[] | undefined,
  sx: (ms: number) => number,
  plotX: number,
  plotW: number,
): "above" | "below" {
  const CHIP_H = 21; // высота подписи с отступом
  let side: "above" | "below" = "above";

  if (candles && candles.length > 0) {
    let below = 0;
    let visible = 0;
    for (const c of candles) {
      const x = sx(c.t);
      if (x < plotX || x > plotX + plotW) continue;
      visible++;
      if ((c.h + c.l) / 2 < price) below++;
    }
    // Большинство свечей ниже уровня — он сверху, там и место для подписи.
    if (visible > 0) side = below * 2 >= visible ? "above" : "below";
  }

  // У края графика переворачиваем: подпись, вылезшая за холст, не читается.
  if (side === "above" && y - CHIP_H < 0) return "below";
  if (side === "below" && y + CHIP_H > plotH) return "above";
  return side;
}

/** Подпись с ценой у самой линии — с подложкой, чтобы читалась поверх свечей. */
function drawPriceChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  price: number,
  color: string,
  side: "above" | "below",
  plotX: number,
  plotW: number,
): void {
  const text = fmtPriceLabel(price);
  ctx.save();
  ctx.font = "11px ui-sans-serif, system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  const w = ctx.measureText(text).width + 8;
  const h = 15;
  // Не даём подписи уехать за правый край области графика.
  const bx = Math.min(x, plotX + plotW - w - 2);
  const by = side === "above" ? y - 6 - h : y + 6;
  ctx.fillStyle = "rgba(8, 8, 13, 0.82)";
  ctx.fillRect(bx, by, w, h);
  ctx.fillStyle = color;
  ctx.fillText(text, bx + 4, by + h / 2);
  ctx.restore();
}

/** Маленький кружок-маркер на точках рисунка. */
function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, selected: boolean): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, selected ? 4 : 3, 0, Math.PI * 2);
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ─── Hit testing ─────────────────────────────────────────────────────────────

const HIT_RADIUS = 6; // px — радиус попадания в линию

/** Найти рисунок под курсором. Возвращает { id, pointIdx, toolType } или null.
 *  Для rectangle: pointIdx = -1 (контур — тащим фигуру целиком),
 *  0..3 (углы TL, TR, BL, BR), 4..7 (середины сторон: левая, правая, верх,
 *  низ — тянут ровно одну грань, как в TradingView). */
export function findDrawingAt(
  mx: number,
  my: number,
  drawings: DrawingRow[],
  sx: (ms: number) => number,
  sy: (price: number) => number,
  plotX: number,
  plotW: number,
  _plotH: number,
): { id: string; pointIdx: number; toolType: DrawingToolType } | null {
  // Идём в обратном порядке — верхний рисунок (последний созданный) выбирается первым
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];
    // Validate d.points before attempting to parse
    if (!d.points || typeof d.points !== 'string') {
      continue;
    }

    let pts: DrawingPoint[];
    try {
      pts = JSON.parse(d.points);
      // Validate that pts is an array of DrawingPoint objects
      if (!Array.isArray(pts) || pts.length === 0) {
        continue;
      }
    } catch {
      // If JSON parsing fails, skip this drawing
      continue;
    }

    const screenPts = pts.map((p) => ({ x: sx(p.t), y: sy(p.price) }));

    switch (d.toolType) {
      case "trend_line": {
        if (screenPts.length < 2) break;
        if (distToSegment(mx, my, screenPts[0], screenPts[1]) < HIT_RADIUS) {
          return { id: d.id, pointIdx: -1, toolType: d.toolType };
        }
        break;
      }
      case "horizontal_line": {
        const y = screenPts[0].y;
        if (Math.abs(my - y) < HIT_RADIUS && mx >= plotX && mx <= plotX + plotW) {
          return { id: d.id, pointIdx: 0, toolType: d.toolType };
        }
        break;
      }
      case "horizontal_ray": {
        // Луч рисуется только от точки вправо (см. drawDrawings выше) — хит-тест
        // должен начинаться от screenPts[0].x, а не от plotX, иначе клик левее
        // точки (где линии физически нет на экране) всё равно выделяет рисунок.
        const y = screenPts[0].y;
        const rx = screenPts[0].x;
        if (Math.abs(my - y) < HIT_RADIUS && mx >= rx && mx <= plotX + plotW) {
          return { id: d.id, pointIdx: 0, toolType: d.toolType };
        }
        break;
      }
      case "rectangle": {
        if (screenPts.length < 2) break;
        const x0 = Math.min(screenPts[0].x, screenPts[1].x);
        const x1 = Math.max(screenPts[0].x, screenPts[1].x);
        const y0 = Math.min(screenPts[0].y, screenPts[1].y);
        const y1 = Math.max(screenPts[0].y, screenPts[1].y);
        // Сначала проверяем ручки: 0..3 — углы, 4..7 — середины сторон.
        // Углы идут первыми, чтобы на маленьком прямоугольнике выигрывал угол.
        const handles: Array<{ x: number; y: number } | null> = [
          { x: x0, y: y0 }, // 0 TL
          { x: x1, y: y0 }, // 1 TR
          { x: x0, y: y1 }, // 2 BL
          { x: x1, y: y1 }, // 3 BR
          ...rectMidHandles(x0, y0, x1, y1), // 4 L, 5 R, 6 T, 7 B
        ];
        for (let ci = 0; ci < handles.length; ci++) {
          const hnd = handles[ci];
          if (hnd && Math.hypot(mx - hnd.x, my - hnd.y) < HIT_RADIUS + 2) {
            return { id: d.id, pointIdx: ci, toolType: d.toolType };
          }
        }
        // Потом проверяем контур
        if (pointNearRectEdge(mx, my, x0, y0, x1, y1, HIT_RADIUS)) {
          return { id: d.id, pointIdx: -1, toolType: d.toolType };
        }
        break;
      }
    }
  }

  return null;
}

/** Расстояние от точки до отрезка. */
function distToSegment(
  px: number, py: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Проверить, находится ли точка рядом с краем прямоугольника. */
function pointNearRectEdge(
  px: number, py: number,
  x0: number, y0: number,
  x1: number, y1: number,
  r: number,
): boolean {
  return (
    distToSegment(px, py, { x: x0, y: y0 }, { x: x1, y: y0 }) < r ||
    distToSegment(px, py, { x: x1, y: y0 }, { x: x1, y: y1 }) < r ||
    distToSegment(px, py, { x: x1, y: y1 }, { x: x0, y: y1 }) < r ||
    distToSegment(px, py, { x: x0, y: y1 }, { x: x0, y: y0 }) < r
  );
}