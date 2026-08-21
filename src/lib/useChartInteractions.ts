"use client";

// Shared pan/zoom/drawing-tools interaction layer for canvas candlestick charts.
// Used by both /dashboard/orderflow and /dashboard/forex so drag-to-pan,
// wheel/edge-drag zoom, magnet snapping and drawing tools behave identically
// everywhere and only need to be fixed once.

import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { findDrawingAt } from "@/components/DrawingOverlay";
import type { DrawingRow, DrawingToolType, DrawingPoint } from "@/lib/drawings";
import { LINEAR_TIME_AXIS, makeTimeProjection, type Candle, type TimeAxis } from "@/lib/candlestickChart";

export type ChartView = { t0: number; t1: number; y0: number; y1: number };
export type ChartBounds = { t0: number; t1: number; y0: number; y1: number; step: number };
export type ChartLayout = { plotX: number; plotW: number; plotH: number };
type DragState = {
  mx: number;
  my: number;
  mode: "pan" | "zoomX" | "zoomY";
  view: ChartView;
  drawingId?: string;
  originalPoints?: DrawingPoint[];
};
type DrawingResizeState = {
  drawingId: string;
  cornerIdx: number; // 0=TL,1=TR,2=BL,3=BR
  origMinT: number;
  origMaxT: number;
  origMinPrice: number;
  origMaxPrice: number;
  originalPoints: DrawingPoint[];
};
type DrawingDragState = { drawingId: string; dx: number; dy: number; originalPoints: DrawingPoint[] };

const ZOOM_IN_LIMIT = 1;
const ZOOM_OUT_LIMIT = 2;

/** Snap a chart-space point to the nearest candle's high/low, if magnet is enabled. */
export function snapToCandle(
  t: number,
  price: number,
  candles: Candle[],
  magnet: boolean,
): { t: number; price: number } {
  if (!magnet || !candles.length) return { t, price };
  let nearest = candles[0];
  let minDist = Math.abs(t - candles[0].t);
  for (const c of candles) {
    const d = Math.abs(t - c.t);
    if (d < minDist) { minDist = d; nearest = c; }
  }
  const step = candles.length > 1 ? candles[1].t - candles[0].t : 60000;
  const snapTimeThreshold = step * 0.5;
  if (minDist >= snapTimeThreshold) return { t, price };
  const range = nearest.h - nearest.l || 1;
  const snapPriceThreshold = range * 0.6;
  const distHigh = Math.abs(price - nearest.h);
  const distLow = Math.abs(price - nearest.l);
  const snappedPrice = distHigh < snapPriceThreshold ? nearest.h : distLow < snapPriceThreshold ? nearest.l : price;
  return { t: nearest.t, price: snappedPrice };
}

export interface ChartInteractionsOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  getCandles: () => Candle[];
  getDrawings: () => DrawingRow[];
  showDrawings: boolean;
  magnet: boolean;
  /** Блокирует выбор/перетаскивание/ресайз существующих рисунков (клик по ним
   * ведёт себя как клик по пустому месту — пан/зум). Не влияет на создание
   * новых рисунков активным инструментом. */
  locked: boolean;
  activeTool: DrawingToolType | null;
  setActiveTool: (tool: DrawingToolType | null) => void;
  drawingPoints: DrawingPoint[];
  setDrawingPoints: (points: DrawingPoint[]) => void;
  selectedDrawingId: string | null;
  setSelectedDrawingId: (id: string | null) => void;
  setShowDrawingEditor: (v: boolean) => void;
  saveDrawing: (toolType: DrawingToolType, points: DrawingPoint[]) => void;
  updateDrawing: (id: string, points: DrawingPoint[]) => void;
  redraw: () => void;
  /** true, если в БД может быть ещё более старая история (не упёрлись в реальный край). */
  getHasMoreHistory?: () => boolean;
  /** Запросить дозагрузку более старых свечей — вызывается при приближении
   * pan/zoom к левому краю уже загруженных данных. Дедуп "уже грузим" и
   * реальную загрузку делает вызывающая сторона (страница); хук только
   * троттлит частоту вызовов. */
  onNeedHistory?: () => void;
  /** Вызывается сразу после того, как перетаскивание/ресайз рисунка сохранены
   * (updateDrawing уже вызван) — previousPoints это геометрия ДО перетаскивания,
   * чтобы вызывающая сторона могла реализовать "отменить последнее перемещение". */
  onDrawingMoved?: (id: string, previousPoints: DrawingPoint[]) => void;
  /** Delete/Backspace на клавиатуре при выбранном рисунке (если !locked). */
  onDeleteSelected?: () => void;
  /** Ось времени графика. Для форекса она сжимает выходные (см. buildTimeAxis),
   * поэтому ВСЕ пересчёты «пиксель ↔ время» здесь обязаны идти через неё:
   * иначе курсор, перетаскивание и зум промахиваются мимо свечей ровно на
   * ширину схлопнутых промежутков. По умолчанию — линейная (крипта, 24/7). */
  getTimeAxis?: () => TimeAxis;
}

// Доля видимого окна от левого края загруженных данных, при приближении к
// которой запрашивается более старая история — не ждём упора в самый край
// (известная грабля из прошлого lazy-loading фикса форекса: порог "впритык"
// даёт заметный рывок/пустоту, пока грузится ответ).
const HISTORY_TRIGGER_FRACTION = 0.3;
// Не долбим бэкенд на каждый mousemove/wheel-тик при быстром скролле.
const HISTORY_TRIGGER_THROTTLE_MS = 400;
// Запас слева от самой первой свечи (в долях ширины видимого окна), когда
// история реально закончилась — иначе первая свеча прилипает ровно к краю.
const EDGE_PADDING_FRACTION = 0.1;

export function useChartInteractions(opts: ChartInteractionsOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Ось и проекция окна на пиксели — единая точка пересчёта для всего хука.
  const axisOf = useCallback(() => optsRef.current.getTimeAxis?.() ?? LINEAR_TIME_AXIS, []);
  const projOf = useCallback((view: ChartView, lay: ChartLayout) =>
    makeTimeProjection(axisOf(), view.t0, view.t1, lay.plotX, lay.plotW), [axisOf]);

  const viewRef = useRef<ChartView | null>(null);
  const layoutRef = useRef<ChartLayout | null>(null);
  const boundsRef = useRef<ChartBounds | null>(null);
  const hoverRef = useRef<{ mx: number; my: number } | null>(null);
  const snappedRef = useRef<{ t: number; price: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const drawingDragRef = useRef<DrawingDragState | null>(null);
  const drawingResizeRef = useRef<DrawingResizeState | null>(null);
  const lastHistoryTriggerRef = useRef(0);
  const rafPendingRef = useRef(false);

  // Коалесирует несколько redraw() за один кадр в один вызов — mousemove/wheel
  // могут стрелять чаще, чем браузер успевает рисовать (60-120+ раз/сек).
  const scheduleRedraw = useCallback(() => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      optsRef.current.redraw();
    });
  }, []);

  const maybeTriggerHistory = useCallback((view: ChartView) => {
    const o = optsRef.current;
    if (!o.onNeedHistory || !o.getHasMoreHistory?.()) return;
    const b = boundsRef.current;
    if (!b) return;
    // Ширину окна и расстояние до края данных меряем в «торговом» времени:
    // на линейной оси попавшие в окно выходные раздували бы span, и догрузка
    // истории срабатывала бы раньше времени.
    const axis = axisOf();
    const span = axis.compress(view.t1) - axis.compress(view.t0) || 1;
    if (axis.compress(view.t0) - axis.compress(b.t0) > span * HISTORY_TRIGGER_FRACTION) return;
    const now = Date.now();
    if (now - lastHistoryTriggerRef.current < HISTORY_TRIGGER_THROTTLE_MS) return;
    lastHistoryTriggerRef.current = now;
    o.onNeedHistory();
  }, [axisOf]);

  // Не даёт панорамировать/зумить левее реально загруженных данных
  // (boundsRef.t0) — иначе пользователь утаскивает окно в пустоту раньше
  // того, что вообще есть в БД/подгружено на клиенте, и видит чёрный холст
  // с "Загрузка истории", хотя грузить уже нечего (или ещё не подгрузилось).
  // Сдвигает t0/t1 на одну и ту же дельту, чтобы не менять масштаб (span).
  //
  // Когда история действительно кончилась (getHasMoreHistory() === false —
  // настоящий край, не просто "ещё не подгрузили"), даём небольшой запас
  // (EDGE_PADDING_FRACTION) влево от первой свечи — иначе она прилипает
  // ровно к краю графика без всякого отступа.
  const clampToBounds = useCallback((view: ChartView): ChartView => {
    const b = boundsRef.current;
    if (!b) return view;
    const o = optsRef.current;
    const atRealEdge = o.getHasMoreHistory ? !o.getHasMoreHistory() : false;
    const axis = axisOf();
    const c0 = axis.compress(view.t0);
    const c1 = axis.compress(view.t1);
    const span = c1 - c0 || 1;
    const minC0 = axis.compress(b.t0) - (atRealEdge ? span * EDGE_PADDING_FRACTION : 0);
    if (c0 >= minC0) return view;
    // Сдвигаем окно в сжатом времени и разворачиваем обратно — иначе одинаковая
    // добавка в реальных мс давала бы разный сдвиг слева и справа от выходных.
    const shift = minC0 - c0;
    return { ...view, t0: axis.expand(c0 + shift), t1: axis.expand(c1 + shift) };
  }, [axisOf]);

  const onMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const o = optsRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    hoverRef.current = { mx, my };
    const drag = dragRef.current;
    const lay = layoutRef.current;
    const candles = o.getCandles();
    const magnet = o.magnet;

    if (o.activeTool && lay && mx >= lay.plotX && mx <= lay.plotX + lay.plotW && my >= 0 && my <= lay.plotH) {
      const cv = o.canvasRef.current;
      if (cv) cv.style.cursor = "crosshair";
      const v = viewRef.current;
      if (v && candles.length) {
        const yspan = v.y1 - v.y0 || 1;
        const t = projOf(v, lay).invX(mx);
        const price = v.y1 - (my / lay.plotH) * yspan;
        snappedRef.current = snapToCandle(t, price, candles, magnet);
      } else {
        snappedRef.current = null;
      }
      scheduleRedraw();
      return;
    }

    if (drag && lay) {
      if (drag.drawingId) {
        const v = viewRef.current;
        if (v) {
          const proj = projOf(v, lay);
          const yspan = v.y1 - v.y0 || 1;
          const cv = o.canvasRef.current;
          if (drawingResizeRef.current) {
            let tChart = proj.invX(mx);
            let priceChart = v.y1 - (my / lay.plotH) * yspan;
            if (magnet && candles.length) {
              const snapped = snapToCandle(tChart, priceChart, candles, true);
              snappedRef.current = snapped;
              tChart = snapped.t;
              priceChart = snapped.price;
            }
            const rs = drawingResizeRef.current;
            let newT1: number, newT2: number, newP1: number, newP2: number;
            switch (rs.cornerIdx) {
              case 0:
                newT1 = Math.round(tChart); newT2 = rs.origMaxT;
                newP1 = priceChart; newP2 = rs.origMinPrice;
                break;
              case 1:
                newT1 = rs.origMinT; newT2 = Math.round(tChart);
                newP1 = priceChart; newP2 = rs.origMinPrice;
                break;
              case 2:
                newT1 = Math.round(tChart); newT2 = rs.origMaxT;
                newP1 = rs.origMaxPrice; newP2 = priceChart;
                break;
              default:
                newT1 = rs.origMinT; newT2 = Math.round(tChart);
                newP1 = rs.origMaxPrice; newP2 = priceChart;
                break;
            }
            drawingDragRef.current = {
              drawingId: rs.drawingId,
              dx: 0, dy: 0,
              originalPoints: [{ t: newT1, price: newP1 }, { t: newT2, price: newP2 }],
            };
            if (cv) cv.style.cursor = "nwse-resize";
            scheduleRedraw();
            return;
          }
          // Горизонтальный сдвиг считаем в «торговом» времени и переводим в
          // реальные мс по якорной точке: на сжатой оси одинаковый сдвиг в
          // пикселях — это разное число реальных мс до и после выходных.
          const anchorT = drag.originalPoints?.[0]?.t ?? drag.view.t0;
          const axis = axisOf();
          const cdx = ((mx - drag.mx) / lay.plotW) * proj.cspan;
          const dx = axis.expand(axis.compress(anchorT) + cdx) - anchorT;
          const dy = ((my - drag.my) / lay.plotH) * yspan;
          if (magnet && candles.length && drag.originalPoints?.length) {
            const anchor = drag.originalPoints[0];
            const endT = anchor.t + dx;
            const endPrice = anchor.price - dy;
            const snapped = snapToCandle(endT, endPrice, candles, true);
            const snappedDx = snapped.t - anchor.t;
            const snappedDy = anchor.price - snapped.price;
            snappedRef.current = snapped;
            drawingDragRef.current = {
              drawingId: drag.drawingId,
              dx: snappedDx,
              dy: snappedDy,
              originalPoints: drag.originalPoints ?? [],
            };
            scheduleRedraw();
            return;
          }
          drawingDragRef.current = {
            drawingId: drag.drawingId,
            dx, dy,
            originalPoints: drag.originalPoints ?? [],
          };
          scheduleRedraw();
          return;
        }
      } else if (drag.mode === "zoomY") {
        const f = Math.exp((my - drag.my) * 0.006);
        const cy = (drag.view.y0 + drag.view.y1) / 2;
        const b = boundsRef.current;
        const minP = b ? (b.y1 - b.y0) * 0.05 * ZOOM_IN_LIMIT : 0;
        const maxP = b ? (b.y1 - b.y0) * ZOOM_OUT_LIMIT : Infinity;
        const span = Math.min(maxP, Math.max(minP, (drag.view.y1 - drag.view.y0) * f));
        viewRef.current = { ...drag.view, y0: cy - span / 2, y1: cy + span / 2 };
      } else if (drag.mode === "zoomX") {
        const f = Math.exp(-(mx - drag.mx) * 0.006);
        const axis = axisOf();
        const c0 = axis.compress(drag.view.t0);
        const c1 = axis.compress(drag.view.t1);
        const cx = (c0 + c1) / 2;
        const b = boundsRef.current;
        const minT = b ? b.step * 3 * ZOOM_IN_LIMIT : 0;
        const maxT = b ? (axis.compress(b.t1) - axis.compress(b.t0)) * ZOOM_OUT_LIMIT : Infinity;
        const span = Math.min(maxT, Math.max(minT, (c1 - c0) * f));
        viewRef.current = clampToBounds({
          ...drag.view,
          t0: axis.expand(cx - span / 2),
          t1: axis.expand(cx + span / 2),
        });
        maybeTriggerHistory(viewRef.current);
      } else {
        const axis = axisOf();
        const c0 = axis.compress(drag.view.t0);
        const c1 = axis.compress(drag.view.t1);
        const dt = ((mx - drag.mx) / lay.plotW) * (c1 - c0);
        const dp = ((my - drag.my) / lay.plotH) * (drag.view.y1 - drag.view.y0);
        viewRef.current = clampToBounds({
          t0: axis.expand(c0 - dt),
          t1: axis.expand(c1 - dt),
          y0: drag.view.y0 + dp,
          y1: drag.view.y1 + dp,
        });
        maybeTriggerHistory(viewRef.current);
      }
      scheduleRedraw();
    } else {
      const cv = o.canvasRef.current;
      if (lay && cv) {
        const drawings = o.getDrawings();
        if (!o.activeTool && o.showDrawings && drawings.length > 0) {
          const v = viewRef.current;
          if (v) {
            const yspan = v.y1 - v.y0 || 1;
            const sxLocal = projOf(v, lay).sx;
            const syLocal = (p: number) => lay.plotH - ((p - v.y0) / yspan) * lay.plotH;
            const hit = findDrawingAt(mx, my, drawings, sxLocal, syLocal, lay.plotX, lay.plotW, lay.plotH);
            if (hit) {
              cv.style.cursor = hit.pointIdx >= 0 && hit.pointIdx <= 3 ? "nwse-resize" : "pointer";
            } else {
              cv.style.cursor = mx >= lay.plotX + lay.plotW ? "ns-resize" : my >= lay.plotH - 8 ? "ew-resize" : "default";
            }
          }
        } else {
          cv.style.cursor = mx >= lay.plotX + lay.plotW ? "ns-resize" : my >= lay.plotH - 8 ? "ew-resize" : "default";
        }
      }
      scheduleRedraw();
    }
  }, []);

  const onLeave = useCallback(() => {
    hoverRef.current = null;
    dragRef.current = null;
    drawingResizeRef.current = null;
    scheduleRedraw();
  }, []);

  const onDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const o = optsRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const lay = layoutRef.current;
    if (!lay) {
      if (viewRef.current) {
        dragRef.current = { mx, my, mode: "pan", view: { ...viewRef.current } };
      }
      return;
    }

    if (o.activeTool && mx >= lay.plotX && mx <= lay.plotX + lay.plotW && my >= 0 && my <= lay.plotH) {
      const v = viewRef.current;
      if (!v) return;
      const yspan = v.y1 - v.y0 || 1;
      const t = projOf(v, lay).invX(mx);
      const price = v.y1 - (my / lay.plotH) * yspan;
      const candles = o.getCandles();
      const snapped = snapToCandle(t, price, candles, o.magnet);

      if (o.activeTool === "horizontal_line" || o.activeTool === "horizontal_ray") {
        o.saveDrawing(o.activeTool, [{ t: Math.round(snapped.t), price: snapped.price }]);
        o.setActiveTool(null);
        return;
      }

      if (o.drawingPoints.length === 0) {
        o.setDrawingPoints([{ t: Math.round(snapped.t), price: snapped.price }]);
      } else {
        o.saveDrawing(o.activeTool, [...o.drawingPoints, { t: Math.round(snapped.t), price: snapped.price }]);
        o.setDrawingPoints([]);
        o.setActiveTool(null);
      }
      return;
    }

    const drawings = o.getDrawings();
    if (!o.locked && !o.activeTool && o.showDrawings && drawings.length > 0 && mx >= lay.plotX && mx <= lay.plotX + lay.plotW && my >= 0 && my <= lay.plotH) {
      const v = viewRef.current;
      if (v) {
        const yspan = v.y1 - v.y0 || 1;
        const sxLocal = projOf(v, lay).sx;
        const syLocal = (p: number) => lay.plotH - ((p - v.y0) / yspan) * lay.plotH;
        const hit = findDrawingAt(mx, my, drawings, sxLocal, syLocal, lay.plotX, lay.plotW, lay.plotH);
        if (hit) {
          o.setSelectedDrawingId(hit.id);
          o.setShowDrawingEditor(true);
          const hitDrawing = drawings.find((d) => d.id === hit.id);
          let originalPoints: DrawingPoint[] = [];
          if (hitDrawing?.points) {
            try { originalPoints = JSON.parse(hitDrawing.points); } catch { /* ignore */ }
          }
          drawingDragRef.current = null;
          drawingResizeRef.current = null;
          if (hitDrawing?.toolType === "rectangle" && hit.pointIdx >= 0 && hit.pointIdx <= 3 && originalPoints.length >= 2) {
            const minT = Math.min(originalPoints[0].t, originalPoints[1].t);
            const maxT = Math.max(originalPoints[0].t, originalPoints[1].t);
            const minPrice = Math.min(originalPoints[0].price, originalPoints[1].price);
            const maxPrice = Math.max(originalPoints[0].price, originalPoints[1].price);
            drawingResizeRef.current = {
              drawingId: hit.id,
              cornerIdx: hit.pointIdx,
              origMinT: minT, origMaxT: maxT,
              origMinPrice: minPrice, origMaxPrice: maxPrice,
              originalPoints,
            };
            if (!dragRef.current) {
              dragRef.current = { mx, my, mode: "pan", view: { ...v }, drawingId: hit.id, originalPoints };
            }
            return;
          }
          if (!dragRef.current) {
            dragRef.current = { mx, my, mode: "pan", view: { ...v }, drawingId: hit.id, originalPoints };
          }
          return;
        }
      }
    }
    if (o.selectedDrawingId && !o.activeTool) {
      o.setSelectedDrawingId(null);
      o.setShowDrawingEditor(false);
      drawingResizeRef.current = null;
    }

    if (viewRef.current) {
      const v2 = viewRef.current;
      const mode2: "pan" | "zoomX" | "zoomY" =
        mx >= lay.plotX + lay.plotW ? "zoomY" : my >= lay.plotH - 8 ? "zoomX" : "pan";
      dragRef.current = { mx, my, mode: mode2, view: { ...v2 } };
    }
  }, []);

  const onUp = useCallback(() => {
    const o = optsRef.current;
    const dd = drawingDragRef.current;
    const rs = drawingResizeRef.current;
    if (dd && dd.originalPoints.length > 0) {
      if (rs) {
        // При ресайзе dd.originalPoints уже перезаписан новой (растянутой)
        // геометрией в onMove — истинное "до" лежит в rs.originalPoints.
        o.updateDrawing(dd.drawingId, dd.originalPoints);
        o.onDrawingMoved?.(dd.drawingId, rs.originalPoints);
      } else {
        const newPoints = dd.originalPoints.map((p) => ({
          t: Math.round(p.t + dd.dx),
          price: p.price - dd.dy,
        }));
        o.updateDrawing(dd.drawingId, newPoints);
        o.onDrawingMoved?.(dd.drawingId, dd.originalPoints);
      }
    }
    drawingDragRef.current = null;
    drawingResizeRef.current = null;
    dragRef.current = null;
  }, []);

  const onDouble = useCallback(() => {
    viewRef.current = null;
    optsRef.current.redraw();
  }, []);

  useEffect(() => {
    const cv = opts.canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      if (!viewRef.current || !layoutRef.current) return;
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { plotX, plotW, plotH } = layoutRef.current;
      const v = viewRef.current;
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      const factor = delta > 0 ? 1.1 : 0.9;
      const fx = Math.min(1, Math.max(0, (mx - plotX) / plotW));
      const fy = Math.min(1, Math.max(0, my / plotH));
      const b = boundsRef.current;
      const axis = axisOf();
      const maxTSpan = b ? (axis.compress(b.t1) - axis.compress(b.t0)) * ZOOM_OUT_LIMIT : Infinity;
      const minTSpan = b ? b.step * 3 * ZOOM_IN_LIMIT : 0;
      const maxPSpan = b ? (b.y1 - b.y0) * ZOOM_OUT_LIMIT : Infinity;
      const minPSpan = b ? (b.y1 - b.y0) * 0.05 * ZOOM_IN_LIMIT : 0;
      const clamp = (val: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, val));

      // Зум держит под курсором ту же точку графика — считаем это в «торговом»
      // времени, иначе при наведении рядом с выходными окно уезжает вбок.
      const cv0 = axis.compress(v.t0);
      const cv1 = axis.compress(v.t1);
      const tcur = cv0 + fx * (cv1 - cv0);
      const tspan = clamp((cv1 - cv0) * factor, minTSpan, maxTSpan);
      let next = { ...v, t0: axis.expand(tcur - fx * tspan), t1: axis.expand(tcur + (1 - fx) * tspan) };
      if (!e.shiftKey) {
        const pcur = v.y1 - fy * (v.y1 - v.y0);
        const pspan = clamp((v.y1 - v.y0) * factor, minPSpan, maxPSpan);
        next = { ...next, y1: pcur + fy * pspan, y0: pcur - (1 - fy) * pspan };
      }
      next = clampToBounds(next);
      viewRef.current = next;
      maybeTriggerHistory(next);
      scheduleRedraw();
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.canvasRef.current]);

  // Delete/Backspace удаляет выбранный рисунок — не срабатывает, пока фокус
  // в текстовом поле (например, в другой части страницы), и не срабатывает
  // при locked (согласуется с блокировкой drag/resize в onDown выше).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const o = optsRef.current;
      if (o.locked || !o.selectedDrawingId || !o.onDeleteSelected) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      o.onDeleteSelected();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    viewRef, layoutRef, boundsRef, hoverRef, snappedRef, dragRef, drawingDragRef, drawingResizeRef,
    onMove, onLeave, onDown, onUp, onDouble,
  };
}
