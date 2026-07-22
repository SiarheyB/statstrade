/**
 * DrawingOverlay — pure function для отрисовки инструментов рисования на canvas.
 * + утилиты для поиска рисунка под курсором.
 *
 * Поддерживает: trend_line, horizontal_line, horizontal_ray, rectangle.
 */

import type { DrawingRow, DrawingPoint } from "@/lib/drawings";

// ─── Rendering ───────────────────────────────────────────────────────────────

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
): void {
  if (!drawings.length) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(plotX, 0, plotW, plotH);
  ctx.clip();

  for (const d of drawings) {
    const pts: DrawingPoint[] = JSON.parse(d.points);
    if (pts.length < 1) continue;

    const isSelected = d.id === selectedId;
    const color = d.color;
    const lw = d.lineWidth;

    // Конвертируем точки в экранные координаты
    const screenPts = pts.map((p) => ({
      x: sx(p.t),
      y: sy(p.price),
    }));

    // Пропускаем, если все точки за пределами экрана
    // Для горизонтальных инструментов проверяем только Y — линия идёт на всю ширину графика
    let allOffscreen: boolean;
    if (d.toolType === "horizontal_line" || d.toolType === "horizontal_ray") {
      allOffscreen = screenPts[0].y < 0 || screenPts[0].y > plotH;
    } else {
      allOffscreen = screenPts.every((p) => p.x < plotX || p.x > plotX + plotW || p.y < 0 || p.y > plotH);
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
        break;
      }
      case "horizontal_ray": {
        const ry = screenPts[0].y;
        if (ry < 0 || ry > plotH) break;
        ctx.beginPath();
        ctx.moveTo(plotX, ry);
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
        drawHandle(ctx, plotX, ry, color, isSelected);
        break;
      }
      case "rectangle": {
        if (screenPts.length < 2) break;
        const x0 = Math.min(screenPts[0].x, screenPts[1].x);
        const x1 = Math.max(screenPts[0].x, screenPts[1].x);
        const y0 = Math.min(screenPts[0].y, screenPts[1].y);
        const y1 = Math.max(screenPts[0].y, screenPts[1].y);
        const w = x1 - x0;
        const h = y1 - y0;
        if (w <= 0 || h <= 0) break;
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
        break;
      }
    }
  }

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

/** Найти рисунок под курсором. Возвращает { id, pointIdx } или null. */
export function findDrawingAt(
  mx: number,
  my: number,
  drawings: DrawingRow[],
  sx: (ms: number) => number,
  sy: (price: number) => number,
  plotX: number,
  plotW: number,
  plotH: number,
): { id: string; pointIdx: number } | null {
  // Идём в обратном порядке — верхний рисунок (последний созданный) выбирается первым
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];
    const pts: DrawingPoint[] = JSON.parse(d.points);
    if (pts.length < 1) continue;

    const screenPts = pts.map((p) => ({ x: sx(p.t), y: sy(p.price) }));

    switch (d.toolType) {
      case "trend_line": {
        if (screenPts.length < 2) break;
        if (distToSegment(mx, my, screenPts[0], screenPts[1]) < HIT_RADIUS) {
          return { id: d.id, pointIdx: -1 };
        }
        break;
      }
      case "horizontal_line":
      case "horizontal_ray": {
        const y = screenPts[0].y;
        if (Math.abs(my - y) < HIT_RADIUS && mx >= plotX && mx <= plotX + plotW) {
          return { id: d.id, pointIdx: 0 };
        }
        break;
      }
      case "rectangle": {
        if (screenPts.length < 2) break;
        const x0 = Math.min(screenPts[0].x, screenPts[1].x);
        const x1 = Math.max(screenPts[0].x, screenPts[1].x);
        const y0 = Math.min(screenPts[0].y, screenPts[1].y);
        const y1 = Math.max(screenPts[0].y, screenPts[1].y);
        // Проверяем попадание в контур прямоугольника
        if (pointNearRectEdge(mx, my, x0, y0, x1, y1, HIT_RADIUS)) {
          return { id: d.id, pointIdx: -1 };
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