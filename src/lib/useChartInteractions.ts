"use client";

// Shared pan/zoom/drawing-tools interaction layer for canvas candlestick charts.
// Used by both /dashboard/orderflow and /dashboard/forex so drag-to-pan,
// wheel/edge-drag zoom, magnet snapping and drawing tools behave identically
// everywhere and only need to be fixed once.

import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { findDrawingAt } from "@/components/DrawingOverlay";
import type { DrawingRow, DrawingToolType, DrawingPoint } from "@/lib/drawings";
import type { Candle } from "@/lib/candlestickChart";

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
}

// Доля видимого окна от левого края загруженных данных, при приближении к
// которой запрашивается более старая история — не ждём упора в самый край
// (известная грабля из прошлого lazy-loading фикса форекса: порог "впритык"
// даёт заметный рывок/пустоту, пока грузится ответ).
const HISTORY_TRIGGER_FRACTION = 0.3;
// Не долбим бэкенд на каждый mousemove/wheel-тик при быстром скролле.
const HISTORY_TRIGGER_THROTTLE_MS = 400;

export function useChartInteractions(opts: ChartInteractionsOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

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
    const span = view.t1 - view.t0 || 1;
    if (view.t0 - b.t0 > span * HISTORY_TRIGGER_FRACTION) return;
    const now = Date.now();
    if (now - lastHistoryTriggerRef.current < HISTORY_TRIGGER_THROTTLE_MS) return;
    lastHistoryTriggerRef.current = now;
    o.onNeedHistory();
  }, []);

  // Не даёт панорамировать/зумить левее реально загруженных данных
  // (boundsRef.t0) — иначе пользователь утаскивает окно в пустоту раньше
  // того, что вообще есть в БД/подгружено на клиенте, и видит чёрный холст
  // с "Загрузка истории", хотя грузить уже нечего (или ещё не подгрузилось).
  // Сдвигает t0/t1 на одну и ту же дельту, чтобы не менять масштаб (span).
  const clampToBounds = useCallback((view: ChartView): ChartView => {
    const b = boundsRef.current;
    if (!b || view.t0 >= b.t0) return view;
    const shift = b.t0 - view.t0;
    return { ...view, t0: view.t0 + shift, t1: view.t1 + shift };
  }, []);

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
        const xspan = v.t1 - v.t0 || 1;
        const yspan = v.y1 - v.y0 || 1;
        const t = v.t0 + ((mx - lay.plotX) / lay.plotW) * xspan;
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
          const xspan = v.t1 - v.t0 || 1;
          const yspan = v.y1 - v.y0 || 1;
          const cv = o.canvasRef.current;
          if (drawingResizeRef.current) {
            let tChart = v.t0 + ((mx - lay.plotX) / lay.plotW) * xspan;
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
          const dx = ((mx - drag.mx) / lay.plotW) * xspan;
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
        const cx = (drag.view.t0 + drag.view.t1) / 2;
        const b = boundsRef.current;
        const minT = b ? b.step * 3 * ZOOM_IN_LIMIT : 0;
        const maxT = b ? (b.t1 - b.t0) * ZOOM_OUT_LIMIT : Infinity;
        const span = Math.min(maxT, Math.max(minT, (drag.view.t1 - drag.view.t0) * f));
        viewRef.current = clampToBounds({ ...drag.view, t0: cx - span / 2, t1: cx + span / 2 });
        maybeTriggerHistory(viewRef.current);
      } else {
        const dt = ((mx - drag.mx) / lay.plotW) * (drag.view.t1 - drag.view.t0);
        const dp = ((my - drag.my) / lay.plotH) * (drag.view.y1 - drag.view.y0);
        viewRef.current = clampToBounds({
          t0: drag.view.t0 - dt,
          t1: drag.view.t1 - dt,
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
            const xspan = v.t1 - v.t0 || 1;
            const yspan = v.y1 - v.y0 || 1;
            const sxLocal = (ms: number) => lay.plotX + ((ms - v.t0) / xspan) * lay.plotW;
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
      const xspan = v.t1 - v.t0 || 1;
      const yspan = v.y1 - v.y0 || 1;
      const t = v.t0 + ((mx - lay.plotX) / lay.plotW) * xspan;
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
    if (!o.activeTool && o.showDrawings && drawings.length > 0 && mx >= lay.plotX && mx <= lay.plotX + lay.plotW && my >= 0 && my <= lay.plotH) {
      const v = viewRef.current;
      if (v) {
        const xspan = v.t1 - v.t0 || 1;
        const yspan = v.y1 - v.y0 || 1;
        const sxLocal = (ms: number) => lay.plotX + ((ms - v.t0) / xspan) * lay.plotW;
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
        o.updateDrawing(dd.drawingId, dd.originalPoints);
      } else {
        const newPoints = dd.originalPoints.map((p) => ({
          t: Math.round(p.t + dd.dx),
          price: p.price - dd.dy,
        }));
        o.updateDrawing(dd.drawingId, newPoints);
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
      const maxTSpan = b ? (b.t1 - b.t0) * ZOOM_OUT_LIMIT : Infinity;
      const minTSpan = b ? b.step * 3 * ZOOM_IN_LIMIT : 0;
      const maxPSpan = b ? (b.y1 - b.y0) * ZOOM_OUT_LIMIT : Infinity;
      const minPSpan = b ? (b.y1 - b.y0) * 0.05 * ZOOM_IN_LIMIT : 0;
      const clamp = (val: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, val));

      const tcur = v.t0 + fx * (v.t1 - v.t0);
      const tspan = clamp((v.t1 - v.t0) * factor, minTSpan, maxTSpan);
      let next = { ...v, t0: tcur - fx * tspan, t1: tcur + (1 - fx) * tspan };
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

  return {
    viewRef, layoutRef, boundsRef, hoverRef, snappedRef, dragRef, drawingDragRef, drawingResizeRef,
    onMove, onLeave, onDown, onUp, onDouble,
  };
}
