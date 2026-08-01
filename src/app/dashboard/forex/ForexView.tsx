"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, RefreshCw, HelpCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import VolumeProfile from "@/components/VolumeProfile";
import ImbalanceHeatmap from "@/components/ImbalanceHeatmap";
import DivergenceHistory from "@/components/DivergenceHistory";
import DrawingToolbar from "@/components/DrawingToolbar";
import { drawDrawings } from "@/components/DrawingOverlay";
import { drawDivergenceMarkers } from "@/components/DivergenceOverlay";
import type { Imbalance, DivergenceSignal, VolumeProfile as VP } from "@/lib/orderflow";
import type { DrawingRow, DrawingToolType, DrawingPoint } from "@/lib/drawings";
import {
  type Candle,
  computePlotLayout,
  computeInitialView,
  drawPriceGrid,
  drawTimeGrid,
  drawCandlesticks,
  drawCrosshair,
  drawLastPriceTag,
  drawPriceCrosshairTag,
  drawTimeCrosshairTag,
  drawTooltipBox,
  drawDeltaCvdChart,
  drawTwoLineSeries,
  drawHistoryStartBoundary,
  fmtPriceLabel,
  fmtDateDM,
  fmtTimeHM,
  CHART_COLORS,
} from "@/lib/candlestickChart";
import { useChartInteractions } from "@/lib/useChartInteractions";

// ─── Types ────────────────────────────────────────────────────────────────

type BaPoint = { t: number; bidSum: number; askSum: number; volSum: number };
type DeltaPoint = { t: number; delta: number; bidVol: number; askVol: number };
type CvdPoint = { t: number; cvd: number };

type FxResp = {
  symbol: string;
  range: string;
  from: number;
  to: number;
  candles: { t: string; o: number; h: number; l: number; c: number; v: number }[];
  ba: BaPoint[] | null;
  delta: DeltaPoint[] | null;
  cvd: CvdPoint[] | null;
  timezone: string;
};

const RANGES = ["5m", "15m", "1h", "4h", "12h", "1d", "1w"];
const VISIBLE_CANDLES: Record<string, number> = { "5m": 480, "15m": 440, "1h": 400, "4h": 360, "12h": 320, "1d": 300, "1w": 52 };
const DEFAULT_VISIBLE = 360;
// Верхняя граница памяти для догруженной истории (historyRef) — см.
// LAZY_HISTORY_PLAN.md и аналогичную константу на /dashboard/orderflow.
const MAX_HISTORY_CANDLES = 4000;

function parseTime(iso: string): number {
  return new Date(iso).getTime();
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function ForexView() {
  const { t, timezone } = useI18n();
  const [symbol, setSymbol] = useState("EUR/USD");
  const [range, setRange] = useState("1h");
  const [data, setData] = useState<FxResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [pairs, setPairs] = useState<string[]>([]);

  // Sub-component data
  const [vpData, setVpData] = useState<VP | null>(null);
  const [vpLoading, setVpLoading] = useState(false);
  const [vpError, setVpError] = useState<string | null>(null);
  const [imbData, setImbData] = useState<Imbalance | null>(null);
  const [imbLoading, setImbLoading] = useState(false);
  const [imbError, setImbError] = useState<string | null>(null);
  const [divSignals, setDivSignals] = useState<DivergenceSignal[]>([]);
  const [divLoading, setDivLoading] = useState(false);
  const [divError, setDivError] = useState<string | null>(null);

  // Drawing tools / pan / zoom — same feature set as /dashboard/orderflow
  const [drawings, setDrawings] = useState<DrawingRow[]>([]);
  const [showDrawings, setShowDrawings] = useState(true);
  const [activeTool, setActiveTool] = useState<DrawingToolType | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<DrawingPoint[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [showDrawingEditor, setShowDrawingEditor] = useState(false);
  const [magnet, setMagnet] = useState(true);

  // Canvas refs — identical rendering pipeline to /dashboard/orderflow (src/lib/candlestickChart.ts)
  const candleCanvasRef = useRef<HTMLCanvasElement>(null);
  const deltaCanvasRef = useRef<HTMLCanvasElement>(null);
  const baCanvasRef = useRef<HTMLCanvasElement>(null);

  const tailCandles: Candle[] = useMemo(
    () => (data?.candles ?? []).map((c) => ({ t: parseTime(c.t), o: c.o, h: c.h, l: c.l, c: c.c })),
    [data],
  );

  // Дозагрузка истории свечей "влево" (см. LAZY_HISTORY_PLAN.md, тот же
  // паттерн, что и на /dashboard/orderflow). historyRef — старые свечи,
  // догруженные через /api/forex/history, всегда старше tailCandles[0].t.
  const historyRef = useRef<Candle[]>([]);
  const hasMoreHistoryRef = useRef(true);
  const loadingHistoryRef = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const candles: Candle[] = useMemo(
    () => (historyRef.current.length ? [...historyRef.current, ...tailCandles] : tailCandles),
    // historyVersion — не читается напрямую, нужен как повод пересчитать
    // при догрузке истории (historyRef мутируется в ref, без ре-рендера).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tailCandles, historyVersion],
  );

  const loadMoreHistory = useCallback(async () => {
    if (loadingHistoryRef.current || !hasMoreHistoryRef.current || !data) return;
    const before = historyRef.current.length ? historyRef.current[0].t : data.from;
    loadingHistoryRef.current = true;
    setLoadingHistory(true);
    try {
      const p = new URLSearchParams({ symbol, range, before: String(before), limit: "500" });
      const res = await fetch(`/api/forex/history?${p}`);
      if (!res.ok) { hasMoreHistoryRef.current = false; return; }
      const d = await res.json() as {
        candles: { t: string; o: number; h: number; l: number; c: number }[];
        hasMore: boolean;
      };
      const newCandles = (d.candles ?? []).map((c) => ({ t: parseTime(c.t), o: c.o, h: c.h, l: c.l, c: c.c }));
      if (newCandles.length === 0) { hasMoreHistoryRef.current = false; return; }
      let merged = [...newCandles, ...historyRef.current];
      if (merged.length > MAX_HISTORY_CANDLES) {
        merged = merged.slice(merged.length - MAX_HISTORY_CANDLES);
        // Обрезали самый старый конец — если пользователь ещё раньше
        // доскроллит, историю ниже нужно будет запросить заново.
        hasMoreHistoryRef.current = true;
      } else {
        hasMoreHistoryRef.current = d.hasMore;
      }
      historyRef.current = merged;
      setHistoryVersion((v) => v + 1);
    } catch {
      // тихая ошибка — следующий триггер (pan/zoom) попробует снова
    } finally {
      loadingHistoryRef.current = false;
      setLoadingHistory(false);
    }
  }, [data, symbol, range]);

  // ─── Load pairs ───────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/forex/meta")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.pairs) {
          const syms = d.pairs.map((p: { symbol: string }) => p.symbol);
          setPairs(syms);
          setSymbol(prev => syms.includes(prev) ? prev : syms[0]);
        }
      })
      .catch(() => {});
  }, []);

  // ─── Load main data ──────────────────────────────────────────────────

  // ─── Load / save drawings ─────────────────────────────────────────────

  const loadDrawings = useCallback(async () => {
    try {
      const res = await fetch(`/api/forex/drawings?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) return;
      const d = await res.json();
      setDrawings(d.drawings ?? []);
    } catch (err) {
      console.error("[forex drawings] load error:", err);
    }
  }, [symbol]);

  useEffect(() => { loadDrawings(); }, [loadDrawings]);

  const saveDrawing = useCallback(async (toolType: DrawingToolType, pts: DrawingPoint[]) => {
    try {
      const res = await fetch("/api/forex/drawings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, toolType, points: pts }),
      });
      if (!res.ok) return;
      const d = await res.json();
      if (d.drawing) setDrawings(prev => [...prev, d.drawing]);
    } catch (err) {
      console.error("[forex drawings] save error:", err);
    }
  }, [symbol]);

  const updateDrawingApi = useCallback(async (id: string, pts: DrawingPoint[]) => {
    try {
      const res = await fetch(`/api/forex/drawings?id=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: pts }),
      });
      if (!res.ok) return;
      const d = await res.json();
      if (d.drawing) {
        setDrawings(prev => prev.map(drawing => drawing.id === id ? { ...drawing, points: d.drawing.points } : drawing));
      }
    } catch (err) {
      console.error("[forex drawings] update error:", err);
    }
  }, []);

  // ─── Pan / zoom / drawing-tools interaction layer (shared with orderflow) ─

  const redrawAllRef = useRef<() => void>(() => {});
  const {
    viewRef, layoutRef, boundsRef, hoverRef, snappedRef, drawingDragRef, drawingResizeRef,
    onMove, onLeave, onDown, onUp, onDouble,
  } = useChartInteractions({
    canvasRef: candleCanvasRef,
    getCandles: () => candles,
    getDrawings: () => drawings,
    showDrawings,
    magnet,
    activeTool,
    setActiveTool,
    drawingPoints,
    setDrawingPoints,
    selectedDrawingId,
    setSelectedDrawingId,
    setShowDrawingEditor,
    saveDrawing,
    updateDrawing: updateDrawingApi,
    redraw: () => redrawAllRef.current(),
    getHasMoreHistory: () => hasMoreHistoryRef.current,
    onNeedHistory: () => { void loadMoreHistory(); },
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ symbol, range, tz: timezone });
      const res = await fetch(`/api/forex?${p}`);
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch (err) {
      console.error("Forex load error:", err);
    } finally {
      setLoading(false);
    }
  }, [symbol, range, timezone]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Тихое обновление данных раз в 3с — в отличие от load(), НЕ сбрасывает
  // текущий зум/пан пользователя (viewRef), как и на /dashboard/orderflow.
  useEffect(() => {
    let cancelled = false;
    const iv = setInterval(async () => {
      try {
        const p = new URLSearchParams({ symbol, range, tz: timezone });
        const res = await fetch(`/api/forex?${p}`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        setData(d);
      } catch {
        // тихо
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [symbol, range, timezone]);


  // ─── Load volume profile ─────────────────────────────────────────────

  // background=true — фоновый live-опрос (см. интервал ниже): не дёргаем
  // индикатор loading/skeleton, иначе карточка "мигает"/"прыгает" каждые
  // 15с даже когда данные почти не изменились.
  const loadVolumeProfile = useCallback(async (alive: () => boolean, background = false) => {
    if (!background) setVpLoading(true);
    setVpError(null);
    try {
      const r = await fetch(`/api/forex/volume-profile?symbol=${symbol}&period=${range}`);
      const d = r.ok ? await r.json() : null;
      if (!alive()) return;
      if (!d) { setVpError(t("fx.vpFailed")); return; }
      setVpData({
        poc: d.poc?.price ?? 0,
        vah: d.valueArea?.high ?? 0,
        val: d.valueArea?.low ?? 0,
        levels: (d.levels ?? []).map((l: { price: number; volume: number }) => ({
          price: l.price,
          volume: l.volume,
          isPoc: d.poc?.price === l.price,
          isVa: l.price >= (d.valueArea?.low ?? 0) && l.price <= (d.valueArea?.high ?? 0),
          pct: d.poc?.volume ? (l.volume / d.poc.volume) * 100 : 0,
        })),
        totalVolume: (d.levels ?? []).reduce((s: number, l: { volume: number }) => s + l.volume, 0),
        pocVolume: d.poc?.volume ?? 0,
        valueAreaVolume: (d.levels ?? [])
          .filter((l: { price: number }) => l.price >= (d.valueArea?.low ?? 0) && l.price <= (d.valueArea?.high ?? 0))
          .reduce((s: number, l: { volume: number }) => s + l.volume, 0),
        valueAreaPct: 70,
        binSize: 0.0001,
      });
      setVpError(null);
    } catch {
      if (alive()) setVpError(t("auth.networkError"));
    } finally {
      if (alive()) setVpLoading(false);
    }
  }, [symbol, range, t]);

  useEffect(() => {
    let alive = true;
    loadVolumeProfile(() => alive);
    return () => { alive = false; };
  }, [loadVolumeProfile]);

  // ─── Load imbalance ──────────────────────────────────────────────────

  const loadImbalance = useCallback(async (alive: () => boolean, background = false) => {
    if (!background) setImbLoading(true);
    setImbError(null);
    try {
      const r = await fetch(`/api/forex/imbalance?symbol=${symbol}&period=${range}`);
      const d = r.ok ? await r.json() : null;
      if (!alive()) return;
      if (!d) { setImbError(t("fx.imbFailed")); return; }
      const series = d.series ?? [];
      setImbData({
        times: series.map((s: { t: number }) => s.t),
        ratio: series.map((s: { ratio: number }) => s.ratio),
        fullBid: series.map((s: { bidVol: number }) => s.bidVol),
        fullAsk: series.map((s: { askVol: number }) => s.askVol),
        nearBid: series.map((s: { bidVol: number }) => s.bidVol),
        nearAsk: series.map((s: { askVol: number }) => s.askVol),
        alerts: d.current && Math.abs(d.current.ratio) > 0.3
          ? [{
              t: series[series.length - 1]?.t ?? Date.now(),
              type: d.current.ratio > 0 ? "high_imbalance" as const : "low_imbalance" as const,
              value: d.current.ratio,
              message: d.current.ratio > 0 ? "Ask dominance" : "Bid dominance",
            }]
          : [],
      });
      setImbError(null);
    } catch {
      if (alive()) setImbError(t("auth.networkError"));
    } finally {
      if (alive()) setImbLoading(false);
    }
  }, [symbol, range, t]);

  useEffect(() => {
    let alive = true;
    loadImbalance(() => alive);
    return () => { alive = false; };
  }, [loadImbalance]);

  // ─── Load divergence ─────────────────────────────────────────────────

  const loadDivergence = useCallback(async (alive: () => boolean, background = false) => {
    if (!background) setDivLoading(true);
    setDivError(null);
    try {
      const r = await fetch(`/api/forex/divergence?symbol=${symbol}&period=${range}`);
      const d = r.ok ? await r.json() : null;
      if (!alive()) return;
      if (!d) { setDivError(t("fx.divFailed")); return; }
      // API уже отдаёт форму, совпадающую с DivergenceSignal — тем же типом
      // пользуется общий компонент DivergenceHistory на orderflow и forex.
      setDivSignals(d.signals ?? []);
      setDivError(null);
    } catch {
      if (alive()) setDivError(t("auth.networkError"));
    } finally {
      if (alive()) setDivLoading(false);
    }
  }, [symbol, range, t]);

  useEffect(() => {
    let alive = true;
    loadDivergence(() => alive);
    return () => { alive = false; };
  }, [loadDivergence]);

  // Тихое обновление Volume Profile / Imbalance / Divergence раз в 15с —
  // раньше грузились один раз при смене symbol/range и не обновлялись,
  // хотя сами свечи на этой странице живые всегда (см. интервал выше).
  // Реже, чем свечи (3с): это более тяжёлые агрегации, нет тумблера LIVE на
  // форекс-странице — в отличие от /dashboard/orderflow, тут опрос идёт
  // всегда, без возможности выключить.
  useEffect(() => {
    let alive = true;
    const iv = setInterval(() => {
      loadVolumeProfile(() => alive, true);
      loadImbalance(() => alive, true);
      loadDivergence(() => alive, true);
    }, 15000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [loadVolumeProfile, loadImbalance, loadDivergence]);


  // ─── Draw candle chart — same primitives as /dashboard/orderflow ─────

  const draw = useCallback(() => {
    const cv = candleCanvasRef.current;
    if (!cv || !data) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = CHART_COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    if (candles.length === 0) {
      ctx.fillStyle = CHART_COLORS.axisText;
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(t("fx.empty"), W / 2, H / 2);
      ctx.textAlign = "left";
      return;
    }

    const layout = computePlotLayout(W, H);
    const { plotX, plotW, plotH } = layout;
    layoutRef.current = { plotX, plotW, plotH };

    // fullT0 расширяется влево по мере догрузки истории (historyRef) — иначе
    // pan/zoom клэмпились бы по исходному окну data.from (см. LAZY_HISTORY_PLAN.md).
    const fullT0 = candles.length ? Math.min(data.from, candles[0].t) : data.from;
    const fullT1 = data.to;
    let fYMin = candles[0].l;
    let fYMax = candles[0].h;
    for (const k of candles) {
      if (k.l < fYMin) fYMin = k.l;
      if (k.h > fYMax) fYMax = k.h;
    }
    const candleStep = candles.length > 1 ? candles[1].t - candles[0].t : (fullT1 - fullT0) / 40 || 60000;
    boundsRef.current = { t0: fullT0, t1: fullT1, y0: fYMin, y1: fYMax, step: candleStep };
    if (!viewRef.current) {
      const visible = VISIBLE_CANDLES[range] ?? DEFAULT_VISIBLE;
      viewRef.current = computeInitialView(candles, fullT0, fullT1, visible);
    }
    const v = viewRef.current;
    const { t0, t1, y0: yMin, y1: yMax } = v;
    const xspan = t1 - t0 || 1;
    const sx = (ms: number) => plotX + ((ms - t0) / xspan) * plotW;
    const yspan = yMax - yMin || 1;
    const sy = (p: number) => plotH - ((p - yMin) / yspan) * plotH;

    drawPriceGrid(ctx, layout, yMin, yMax, sy);
    drawTimeGrid(ctx, layout, t0, t1, timezone, sx);

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, 0, plotW, plotH);
    ctx.clip();
    drawCandlesticks(ctx, candles, sx, sy, plotX, plotW, xspan, { bodyRatio: 0.4 });
    if (!hasMoreHistoryRef.current && candles.length) {
      drawHistoryStartBoundary(ctx, sx(candles[0].t), layout, t("fx.historyStart"));
    }
    ctx.restore();

    // Дивергенция считается на сервере с более широким lookback, чем окно
    // реально загруженных свечей (нужен запас для поиска свингов) — метки
    // старше первой загруженной свечи фильтруем, иначе при зуме/панораме за
    // пределы загруженных данных они «висят» без свечей под собой.
    const firstCandleT = candles[0]?.t;
    const lastCandleT = candles[candles.length - 1]?.t;
    const visibleDivSignals = firstCandleT !== undefined && lastCandleT !== undefined
      ? divSignals.filter(s => s.t >= firstCandleT && s.t <= lastCandleT)
      : divSignals;
    drawDivergenceMarkers(ctx, sx, sy, plotX, plotW, plotH, visibleDivSignals);

    // Рисунки пользователя (трендовые линии, прямоугольники и т.п.)
    if (showDrawings && drawings.length) {
      const dd = drawingDragRef.current;
      if (dd) {
        const adjusted = drawings.map(d => {
          if (d.id !== dd.drawingId) return d;
          if (drawingResizeRef.current) return { ...d, points: JSON.stringify(dd.originalPoints) };
          try {
            const pts = JSON.parse(d.points) as DrawingPoint[];
            const shifted = pts.map(p => ({ t: Math.round(p.t + dd.dx), price: p.price - dd.dy }));
            return { ...d, points: JSON.stringify(shifted) };
          } catch { return d; }
        });
        drawDrawings(ctx, sx, sy, plotX, plotW, plotH, adjusted, selectedDrawingId);
      } else {
        drawDrawings(ctx, sx, sy, plotX, plotW, plotH, drawings, selectedDrawingId);
      }
    }

    // Live-preview при рисовании: от первой точки до курсора
    if (activeTool && drawingPoints.length === 1) {
      const hov = hoverRef.current;
      if (hov && hov.mx >= plotX && hov.mx <= plotX + plotW && hov.my >= 0 && hov.my <= plotH) {
        const x1 = sx(drawingPoints[0].t);
        const y1 = sy(drawingPoints[0].price);
        let x2 = hov.mx;
        let y2 = hov.my;
        if (magnet && snappedRef.current) {
          x2 = sx(snappedRef.current.t);
          y2 = sy(snappedRef.current.price);
        }
        ctx.save();
        ctx.strokeStyle = CHART_COLORS.accent;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.globalAlpha = 0.6;
        if (activeTool === "trend_line") {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        } else if (activeTool === "rectangle") {
          const rx0 = Math.min(x1, x2);
          const rx1 = Math.max(x1, x2);
          const ry0 = Math.min(y1, y2);
          const ry1 = Math.max(y1, y2);
          ctx.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
        }
        ctx.restore();
      }
    }

    const last = candles[candles.length - 1].c;
    drawLastPriceTag(ctx, last, sy(last), layout);

    const hov = hoverRef.current;
    if (hov && hov.mx >= plotX && hov.mx <= plotX + plotW && hov.my >= 0 && hov.my <= plotH) {
      let cx = hov.mx;
      let cy = hov.my;
      if (activeTool && magnet && snappedRef.current) {
        cx = sx(snappedRef.current.t);
        cy = sy(snappedRef.current.price);
      }
      drawCrosshair(ctx, cx, cy, layout);
      if (activeTool && magnet && snappedRef.current) {
        ctx.fillStyle = CHART_COLORS.accent;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      const ms = t0 + ((cx - plotX) / plotW) * xspan;
      const priceH = yMin + (1 - cy / plotH) * yspan;
      drawPriceCrosshairTag(ctx, priceH, cy, layout);

      const stepMs = candles.length > 1 ? candles[1].t - candles[0].t : 0;
      const cndl = stepMs ? candles.find((k) => ms >= k.t && ms < k.t + stepMs) : undefined;
      const timeLabel = cndl ? `${fmtDateDM(cndl.t, timezone)} ${fmtTimeHM(cndl.t, timezone)}` : fmtTimeHM(ms, timezone);
      drawTimeCrosshairTag(ctx, timeLabel, cx, layout);

      if (cndl) {
        const lines = [
          `${fmtDateDM(cndl.t, timezone)} ${fmtTimeHM(cndl.t, timezone)}`,
          `O ${fmtPriceLabel(cndl.o)}  H ${fmtPriceLabel(cndl.h)}`,
          `L ${fmtPriceLabel(cndl.l)}  C ${fmtPriceLabel(cndl.c)}`,
        ];
        drawTooltipBox(ctx, lines, cx, cy, layout);
      }
    }
  }, [data, candles, range, timezone, t, showDrawings, drawings, selectedDrawingId, activeTool, drawingPoints, magnet, boundsRef, viewRef, layoutRef, hoverRef, snappedRef, drawingDragRef, drawingResizeRef, divSignals]);

  // ─── Draw delta/CVD — same renderer as /dashboard/orderflow ──────────

  const drawDelta = useCallback(() => {
    const cv = deltaCanvasRef.current;
    if (!cv || !data) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const t0 = viewRef.current?.t0 ?? data.from;
    const t1 = viewRef.current?.t1 ?? data.to;
    drawDeltaCvdChart(ctx, {
      W, H, t0, t1,
      times: data.delta?.map((d) => d.t) ?? [],
      delta: data.delta?.map((d) => d.delta) ?? [],
      cvd: data.cvd?.map((c) => c.cvd) ?? null,
      emptyText: t("fx.noDelta"),
    });
  }, [data, t, viewRef]);

  // ─── Draw B/A spread — same two-line renderer as /dashboard/orderflow ─

  const drawBA = useCallback(() => {
    const cv = baCanvasRef.current;
    if (!cv || !data) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ba = data.ba ?? [];
    const t0 = viewRef.current?.t0 ?? data.from;
    const t1 = viewRef.current?.t1 ?? data.to;
    drawTwoLineSeries(ctx, {
      W, H, t0, t1,
      times: ba.map((b) => b.t),
      a: ba.map((b) => b.bidSum / 10000),
      b: ba.map((b) => b.askSum / 10000),
      colorA: CHART_COLORS.up,
      colorB: CHART_COLORS.down,
      labelA: "bid",
      labelB: "ask",
      title: "B/A",
      emptyText: t("fx.noBa"),
      fillBand: true,
    });
  }, [data, t, viewRef]);

  const redrawAll = useCallback(() => {
    draw();
    drawDelta();
    drawBA();
  }, [draw, drawDelta, drawBA]);
  useEffect(() => { redrawAllRef.current = redrawAll; }, [redrawAll]);

  useEffect(() => {
    redrawAll();
    const onResize = () => redrawAll();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [redrawAll]);

  // При смене пары/таймфрейма старый viewRef (масштаб цены/времени) остаётся
  // от прежнего инструмента, пока не придут новые данные — если сбрасывать
  // viewRef сразу в load() (до ответа fetch), возникает окно, когда график
  // рисуется вообще без view (пусто) до следующего пересчёта. Сбрасываем и
  // форсируем перерисовку здесь — в эффекте, который гарантированно видит
  // уже применённые свежие `candles` (не нужен двойной клик, чтобы починить).
  const lastResetKeyRef = useRef<string>("");
  useEffect(() => {
    if (!data) return;
    const key = `${data.symbol}|${data.range}`;
    if (key === lastResetKeyRef.current) return;
    lastResetKeyRef.current = key;
    viewRef.current = null;
    historyRef.current = [];
    hasMoreHistoryRef.current = true;
    setHistoryVersion((v) => v + 1);
    redrawAllRef.current();
  }, [data, viewRef, redrawAllRef]);

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-5 w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp size={18} className="text-accent" />
          {t("fx.title")}
        </h1>
        <div className="flex items-center gap-2">
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="input-base text-xs py-1.5 px-2 cursor-pointer"
            title={t("fx.hintSymbol")}
          >
            {pairs.length > 0
              ? pairs.map((p) => <option key={p} value={p}>{p}</option>)
              : <option value="EUR/USD">EUR/USD</option>
            }
          </select>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="input-base text-xs py-1.5 px-2 cursor-pointer"
            title={t("fx.hintTimeframe")}
          >
            {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg input-base text-xs hover:border-border-strong disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Candle chart */}
      <div className="card p-2 relative mb-4" style={{ background: CHART_COLORS.bg }}>
        {showDrawingEditor && selectedDrawingId && (() => {
          const d = drawings.find(dd => dd.id === selectedDrawingId);
          if (!d) return null;
          return (
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 p-2 bg-[#0a0b10]/90 border-b border-border/30 text-xs">
              <span className="text-muted font-medium mr-1">{t("of.drawingEditor")}</span>
              <button
                className="ml-auto text-faint hover:text-fg p-0.5"
                onClick={() => { setSelectedDrawingId(null); setShowDrawingEditor(false); }}
                title="Закрыть"
              >
                ✕
              </button>
              <label className="flex items-center gap-1 text-faint">
                {t("of.color")}
                <input
                  type="color"
                  value={d.color}
                  onChange={async (ev) => {
                    const newColor = ev.target.value;
                    try {
                      const res = await fetch(`/api/forex/drawings?id=${d.id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ color: newColor }),
                      });
                      if (res.ok) setDrawings(prev => prev.map(dd => dd.id === d.id ? { ...dd, color: newColor } : dd));
                    } catch (err) {
                      console.error("Failed to update color", err);
                    }
                  }}
                  className="w-6 h-6 rounded border border-border/30 cursor-pointer"
                />
              </label>
              <label className="flex items-center gap-1 text-faint">
                {t("of.lineWidth")}
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={d.lineWidth}
                  onChange={async (ev) => {
                    const newWidth = Number(ev.target.value);
                    try {
                      const res = await fetch(`/api/forex/drawings?id=${d.id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ lineWidth: newWidth }),
                      });
                      if (res.ok) setDrawings(prev => prev.map(dd => dd.id === d.id ? { ...dd, lineWidth: newWidth } : dd));
                    } catch (err) {
                      console.error("Failed to update width", err);
                    }
                  }}
                  className="w-14"
                />
                <span className="tabular-nums text-faint">{d.lineWidth}</span>
              </label>
              <button
                className="text-[11px] px-2 py-0.5 rounded bg-loss/20 text-loss hover:bg-loss/40 transition-colors"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/forex/drawings?id=${d.id}`, { method: "DELETE" });
                    if (res.ok) {
                      setDrawings(prev => prev.filter(dd => dd.id !== d.id));
                      setSelectedDrawingId(null);
                      setShowDrawingEditor(false);
                    }
                  } catch (err) {
                    console.error("Failed to delete drawing", err);
                  }
                }}
              >
                {t("of.delete")}
              </button>
            </div>
          );
        })()}
        <div className="relative">
          <DrawingToolbar
            overlay
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            magnet={magnet}
            onToggleMagnet={() => setMagnet(v => !v)}
            showDrawings={showDrawings}
            onToggleShowDrawings={() => setShowDrawings(v => !v)}
          />
          <canvas
            ref={candleCanvasRef}
            className="w-full cursor-crosshair"
            style={{ height: "min(72vh, 720px)" }}
            onMouseMove={onMove}
            onMouseLeave={onLeave}
            onMouseDown={onDown}
            onMouseUp={onUp}
            onDoubleClick={onDouble}
          />
          {loadingHistory && (
            <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" />
              {t("fx.loadingHistory")}
            </div>
          )}
        </div>
      </div>
      <div className="mt-1 mb-4 text-[11px] text-faint">{t("of.zoomHint")}</div>

      {/* Delta / CVD */}
      <div className="card mb-4">
        <div className="text-xs text-muted mb-1 px-2 pt-2 inline-flex items-center gap-1.5">
          {t("fx.deltaCvd")}
          <span title={t("fx.hintDeltaCvd")} className="inline-flex cursor-help">
            <HelpCircle size={12} className="text-faint shrink-0" />
          </span>
        </div>
        {data?.delta ? (
          <canvas ref={deltaCanvasRef} className="w-full h-[80px]" />
        ) : (
          <div className="px-2 py-4 text-xs text-faint">{t("fx.noDelta")}</div>
        )}
      </div>

      {/* B/A Spread */}
      <div className="card mb-4">
        <div className="text-xs text-muted mb-1 px-2 pt-2 inline-flex items-center gap-1.5">
          {t("fx.bidAsk")}
          <span title={t("fx.hintBidAsk")} className="inline-flex cursor-help">
            <HelpCircle size={12} className="text-faint shrink-0" />
          </span>
        </div>
        {data?.ba ? (
          <canvas ref={baCanvasRef} className="w-full h-[80px]" />
        ) : (
          <div className="px-2 py-4 text-xs text-faint">{t("fx.noBa")}</div>
        )}
      </div>

      {/* Bottom panels — компоненты сами рисуют свою карточку и заголовок
          (как на /dashboard/orderflow) — не оборачиваем их ещё в один .card
          (двойной контур) и не ставим в общую grid-строку (VolumeProfile и
          ImbalanceHeatmap разной высоты — внутри ImbalanceHeatmap фиксированная
          высота графика, растянутая ячейка grid оставляла бы под ним пустоту). */}
      <VolumeProfile data={vpData} loading={vpLoading} error={vpError} />
      <ImbalanceHeatmap data={imbData} loading={imbLoading} error={imbError} />
      <DivergenceHistory signals={divSignals} loading={divLoading} error={divError} />
    </div>
  );
}
