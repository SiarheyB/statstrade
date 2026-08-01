"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Layers,
  RefreshCw,
  HelpCircle,
  Filter,
  AlertTriangle,
  Pencil,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  TrendingUp,
  Square,
  Minus,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  zonedParts,
  shiftedMs,
  type TimezoneId,
  normalizeTimezone,
  getTimezoneFromCookie,
} from "@/lib/timezone";
import VolumeProfile from "@/components/VolumeProfile";
import type { VolumeProfile as VPData } from "@/components/VolumeProfile";
import { drawDivergenceMarkers } from "@/components/DivergenceOverlay";
import { drawAbsorptionMarkers } from "@/components/AbsorptionOverlay";
import { drawDrawings, findDrawingAt } from "@/components/DrawingOverlay";
import DivergenceHistory from "@/components/DivergenceHistory";
import AbsorptionPanel from "@/components/AbsorptionPanel";
import DrawingToolbar from "@/components/DrawingToolbar";
import ImbalanceHeatmap from "@/components/ImbalanceHeatmap";
import type {
  DivergenceSignal,
  Imbalance,
  SpeedOfTape,
  AbsorptionSignal,
} from "@/lib/orderflow";
import type {
  DrawingRow,
  DrawingToolType,
  DrawingPoint,
} from "@/lib/drawings";
import {
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
  fmtPriceLabel as fmtP,
  fmtValLabel as fmtVal,
  fmtTimeHM as fmtTime,
  PADL,
  PADR,
  PADB,
  PRICE_AXIS_W,
} from "@/lib/candlestickChart";
import { useChartInteractions } from "@/lib/useChartInteractions";

type ObHeatmap = {
  priceMin: number;
  priceMax: number;
  bins: number;
  cols: number;
  grid: number[][];
  maxVal: number;
  price: number;
  times: number[];
  profileBid: number[];
  profileAsk: number[];
  profileMax: number;
};
type Candle = { t: number; o: number; h: number; l: number; c: number };
type DeltaSeries = { times: number[]; buy: number[]; sell: number[]; delta: number[]; cvd: number[] };
type FootprintLevel = { price: number; buy: number; sell: number };
type Footprint = { interval: number; maxVol: number; candles: { t: number; levels: FootprintLevel[] }[] };
type BaSeries = { times: number[]; full: number[]; near: number[] };
type BigTrade = { t: number; price: number; qty: number; side: string; exchange: string };
type Resp = {
  symbol: string;
  exchange: string;
  range: string;
  from: number;
  to: number;
  heatmap: ObHeatmap | null;
  candles: Candle[];
  delta: DeltaSeries | null;
  footprint: Footprint | null;
  ba: BaSeries | null;
  bigTrades: BigTrade[];
};

const RANGES = ["5m", "15m", "1h", "4h", "12h", "1d", "1w"] as const;
const VISIBLE_CANDLES: Record<string, number> = { "5m": 130, "15m": 120, "1h": 110, "4h": 100, "12h": 95, "1d": 90, "1w": 60 };
const DEFAULT_VISIBLE = 100;
// Верхняя граница памяти для догруженной истории (historyRef). При
// превышении обрезаем самый старый конец — если пользователь доскроллит
// туда снова, история перезапросится тем же механизмом, что и в первый раз.
const MAX_HISTORY_CANDLES = 4000;
const FALLBACK_EXCHANGES = ["binance-futures", "binance-spot"];
const FALLBACK_SYMBOLS = ["BTCUSDT", "ETHUSDT"];

const BIG_LIMIT_COINS: Record<string, number> = { BTCUSDT: 500, ETHUSDT: 5000 };
const DEFAULT_BIG_LIMIT_COINS = 500;
function bigLimitFor(symbol: string): number {
  return BIG_LIMIT_COINS[symbol.toUpperCase()] ?? DEFAULT_BIG_LIMIT_COINS;
}

function fmtCrosshairLabel(ms: number, tz: TimezoneId, locale: string): string {
  const { ms: shifted } = shiftedMs(ms, tz);
  const d = new Date(shifted);
  const f = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  return f.format(d);
}
function fmtDateTime(ms: number, tz: TimezoneId): string {
  const { d, mo, h, mi } = zonedParts(ms, tz);
  const p = (z: number) => String(z).padStart(2, "0");
  return `${p(d)}.${p(mo + 1)} ${p(h)}:${p(mi)}`;
}
function baseAsset(symbol: string): string {
  return symbol.replace(/(USDT|USDC|BUSD|USD|FDUSD)$/i, "") || symbol;
}

const WALL_LEVELS = 8;
function buildOffscreen(hm: ObHeatmap, minT: number, gamma: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = hm.cols;
  cv.height = hm.bins;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(hm.cols, hm.bins);
  for (let c = 0; c < hm.cols; c++) {
    const col = hm.grid[c];
    for (let b = 0; b < hm.bins; b++) {
      const lin = hm.maxVal ? col[b] / hm.maxVal : 0;
      const row = hm.bins - 1 - b;
      const idx = (row * hm.cols + c) * 4;
      if (lin < minT) {
        img.data[idx + 3] = 0;
        continue;
      }
      let t = Math.pow(lin, gamma);
      t = Math.round(t * WALL_LEVELS) / WALL_LEVELS;
      const g = 170 + Math.round(75 * t);
      img.data[idx] = g;
      img.data[idx + 1] = g;
      img.data[idx + 2] = g;
      img.data[idx + 3] = Math.round(235 * t);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export default function OrderflowPage() {
  const { t, timezone, locale } = useI18n();
  const [range, setRange] = useState<string>("1d");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [exchange, setExchange] = useState("binance-futures");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minPct, setMinPct] = useState(20);
  const [brightness, setBrightness] = useState(55);
  const [live, setLive] = useState(true);
  const [clusters, setClusters] = useState(true);
  const [showLiq, setShowLiq] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [metaSymbols, setMetaSymbols] = useState<string[]>(FALLBACK_SYMBOLS);
  const [metaExchanges, setMetaExchanges] = useState<string[]>(FALLBACK_EXCHANGES);
  const [metaMinCoins, setMetaMinCoins] = useState<Record<string, number>>({});
  const [vpData, setVpData] = useState<VPData | null>(null);
  const [vpLoading, setVpLoading] = useState(false);
  const [vpError, setVpError] = useState<string | null>(null);
  const [divergenceSignals, setDivergenceSignals] = useState<DivergenceSignal[]>([]);
  const [divLoading, setDivLoading] = useState(false);
  const [divError, setDivError] = useState<string | null>(null);
  const [showDivergence, setShowDivergence] = useState(true);
  const [imbalanceData, setImbalanceData] = useState<Imbalance | null>(null);
  const [speedData, setSpeedData] = useState<SpeedOfTape | null>(null);
  const [imbalanceLoading, setImbalanceLoading] = useState(false);
  const [imbalanceError, setImbalanceError] = useState<string | null>(null);
  const [absorptionSignals, setAbsorptionSignals] = useState<AbsorptionSignal[]>([]);
  const [absorptionLoading, setAbsorptionLoading] = useState(false);
  const [absorptionError, setAbsorptionError] = useState<string | null>(null);
  const [showAbsorption, setShowAbsorption] = useState(true);
  const [drawings, setDrawings] = useState<DrawingRow[]>([]);
  const [drawingsLoading, setDrawingsLoading] = useState(false);
  const [drawingsError, setDrawingsError] = useState<string | null>(null);
  const [showDrawings, setShowDrawings] = useState(true);
  const [activeTool, setActiveTool] = useState<DrawingToolType | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<DrawingPoint[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [showDrawingEditor, setShowDrawingEditor] = useState(false);
  const [magnet, setMagnet] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deltaRef = useRef<HTMLCanvasElement>(null);
  const baRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);

  // Дозагрузка истории свечей "влево" (см. LAZY_HISTORY_PLAN.md). historyRef —
  // старые свечи, догруженные через /api/orderflow/history, всегда старше
  // data.candles[0].t. hasMoreHistoryRef=false — реально упёрлись в край
  // данных в БД (CANDLE_RETENTION_DAYS коллектора).
  const historyRef = useRef<Candle[]>([]);
  const hasMoreHistoryRef = useRef(true);
  const loadingHistoryRef = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const gamma = useMemo(() => 1 - (brightness / 100) * 0.8, [brightness]);
  const minT = useMemo(() => minPct / 100, [minPct]);

  const loadDrawings = useCallback(async () => {
    setDrawingsLoading(true);
    setDrawingsError(null);
    try {
      const res = await fetch(`/api/orderflow/drawings?symbol=${symbol}&exchange=${exchange}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error" }));
        setDrawingsError(err.error ?? "Error");
        setDrawings([]);
        return;
      }
      const d = await res.json();
      setDrawings(d.drawings ?? []);
    } catch {
      setDrawingsError("Network error");
      setDrawings([]);
    } finally {
      setDrawingsLoading(false);
    }
  }, [symbol, exchange]);

  const saveDrawing = useCallback(async (toolType: DrawingToolType, pts: DrawingPoint[]) => {
    try {
      const res = await fetch("/api/orderflow/drawings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, exchange, toolType, points: pts }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "unknown error");
        console.error("[drawings] save failed:", res.status, errText);
        return;
      }
      const d = await res.json();
      if (d.drawing) {
        setDrawings(prev => [...prev, d.drawing]);
      }
    } catch (err) {
      console.error("[drawings] save error:", err);
    }
  }, [symbol, exchange]);

  const updateDrawing = useCallback(async (id: string, pts: DrawingPoint[]) => {
    try {
      const res = await fetch(`/api/orderflow/drawings?id=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: pts }),
      });
      if (!res.ok) return;
      const d = await res.json();
      if (d.drawing) {
        setDrawings(prev => prev.map(drawing =>
          drawing.id === id ? { ...drawing, points: d.drawing.points } : drawing
        ));
      }
    } catch (err) {
      console.error("Failed to update drawing:", err);
    }
  }, []);

  const getMergedCandles = useCallback((): Candle[] => {
    const tail = data?.candles ?? [];
    return historyRef.current.length ? [...historyRef.current, ...tail] : tail;
    // historyVersion — не читается напрямую, но нужен как повод пересчитать
    // при догрузке истории (historyRef мутируется в ref, без ре-рендера).
  }, [data, historyVersion]);

  const loadMoreHistory = useCallback(async () => {
    if (loadingHistoryRef.current || !hasMoreHistoryRef.current || !data) return;
    const before = historyRef.current.length ? historyRef.current[0].t : data.from;
    loadingHistoryRef.current = true;
    setLoadingHistory(true);
    try {
      const res = await fetch(
        `/api/orderflow/history?symbol=${symbol}&exchange=${exchange}&range=${range}&before=${before}&limit=500`,
      );
      if (!res.ok) { hasMoreHistoryRef.current = false; return; }
      const d = await res.json() as { candles: Candle[]; hasMore: boolean };
      if (!d.candles?.length) { hasMoreHistoryRef.current = false; return; }
      let merged = [...d.candles, ...historyRef.current];
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
  }, [data, symbol, exchange, range]);

  const redrawAllRef = useRef<() => void>(() => {});
  const {
    viewRef, layoutRef, boundsRef, hoverRef, snappedRef, drawingDragRef, drawingResizeRef,
    onMove, onLeave, onDown, onUp, onDouble,
  } = useChartInteractions({
    canvasRef,
    getCandles: getMergedCandles,
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
    updateDrawing,
    redraw: () => redrawAllRef.current(),
    getHasMoreHistory: () => hasMoreHistoryRef.current,
    onNeedHistory: () => { void loadMoreHistory(); },
  });
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tz = timezone;
      const res = await fetch(`/api/orderflow?range=${range}&symbol=${symbol}&exchange=${exchange}&tz=${tz}`);
      const d = await res.json();
      if (!res.ok) {
        if (res.status === 400 && d.error?.includes("timezone")) {
          console.warn("[orderflow] timezone rejected by server, retrying without tz");
          const res2 = await fetch(`/api/orderflow?range=${range}&symbol=${symbol}&exchange=${exchange}`);
          if (!res2.ok) throw new Error(await res2.text());
          const d2 = await res2.json();
          setData(d2);
          return;
        }
        setError(d.error ?? "Error");
        setData(null);
        return;
      }
      offRef.current = null;
      setData(d);
    } catch (e) {
      setError("Network error");
      console.error("[orderflow] load error:", e);
    } finally {
      setLoading(false);
    }
  }, [range, symbol, exchange, timezone]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("orderflow.settings") || "{}");
      if (typeof s.range === "string") setRange(s.range);
      if (typeof s.symbol === "string") setSymbol(s.symbol);
      if (typeof s.exchange === "string" && s.exchange !== "all") setExchange(s.exchange);
      if (typeof s.minPct === "number") setMinPct(s.minPct);
      if (typeof s.brightness === "number") setBrightness(s.brightness);
      if (typeof s.live === "boolean") setLive(s.live);
      if (typeof s.clusters === "boolean") setClusters(s.clusters);
      if (typeof s.showLiq === "boolean") setShowLiq(s.showLiq);
      if (typeof s.showDivergence === "boolean") setShowDivergence(s.showDivergence);
      if (typeof s.showAbsorption === "boolean") setShowAbsorption(s.showAbsorption);
      if (typeof s.showDrawings === "boolean") setShowDrawings(s.showDrawings);
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        "orderflow.settings",
        JSON.stringify({ range, symbol, exchange, minPct, brightness, live, clusters, showLiq, showDivergence, showAbsorption, showDrawings }),
      );
    } catch {
      // ignore
    }
  }, [hydrated, range, symbol, exchange, minPct, brightness, live, clusters, showLiq, showAbsorption, showDrawings]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/orderflow/meta");
        if (!res.ok) return;
        const m = await res.json();
        if (Array.isArray(m.symbols) && m.symbols.length) setMetaSymbols(m.symbols);
        if (Array.isArray(m.exchanges) && m.exchanges.length) setMetaExchanges(m.exchanges);
        if (m.minCoins && typeof m.minCoins === "object") setMetaMinCoins(m.minCoins);
      } catch {
        // оставляем дефолты
      }
    })();
  }, []);

  const rangeToVpPeriod: Record<string, string> = {
    "5m": "1h",
    "15m": "1h",
    "1h": "1h",
    "4h": "4h",
    "12h": "12h",
    "1d": "24h",
    "1w": "7d",
  };

  const rangeToIndicatorPeriod: Record<string, string> = {
    "5m": "1h",
    "15m": "1h",
    "1h": "1h",
    "4h": "4h",
    "12h": "12h",
    "1d": "24h",
    "1w": "7d",
  };

  const loadVolumeProfile = useCallback(async () => {
    setVpLoading(true);
    setVpError(null);
    try {
      const vpPeriod = rangeToVpPeriod[range] ?? "24h";
      const res = await fetch(`/api/orderflow/volume-profile?symbol=${symbol}&exchange=${exchange}&period=${vpPeriod}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error" }));
        setVpError(err.error ?? "Error");
        setVpData(null);
        return;
      }
      const d = await res.json();
      setVpData(d.volumeProfile);
    } catch {
      setVpError("Network error");
      setVpData(null);
    } finally {
      setVpLoading(false);
    }
  }, [symbol, exchange, range]);

  const loadDivergence = useCallback(async () => {
    setDivLoading(true);
    setDivError(null);
    try {
      const res = await fetch(`/api/orderflow/divergence?symbol=${symbol}&exchange=${exchange}&period=${rangeToIndicatorPeriod[range] ?? range}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error" }));
        setDivError(err.error ?? "Error");
        setDivergenceSignals([]);
        return;
      }
      const d = await res.json();
      setDivergenceSignals(d.divergence?.signals ?? []);
    } catch {
      setDivError("Network error");
      setDivergenceSignals([]);
    } finally {
      setDivLoading(false);
    }
  }, [symbol, exchange, range]);

  const loadImbalance = useCallback(async () => {
    setImbalanceLoading(true);
    setImbalanceError(null);
    try {
      const res = await fetch(`/api/orderflow/imbalance?symbol=${symbol}&exchange=${exchange}&period=${rangeToIndicatorPeriod[range] ?? range}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error" }));
        setImbalanceError(err.error ?? "Error");
        setImbalanceData(null);
        setSpeedData(null);
        return;
      }
      const d = await res.json();
      setImbalanceData(d.imbalance);
      setSpeedData(d.speedOfTape);
    } catch {
      setImbalanceError("Network error");
      setImbalanceData(null);
      setSpeedData(null);
    } finally {
      setImbalanceLoading(false);
    }
  }, [symbol, exchange, range]);

  const loadAbsorption = useCallback(async () => {
    setAbsorptionLoading(true);
    setAbsorptionError(null);
    try {
      const res = await fetch(`/api/orderflow/absorption?symbol=${symbol}&exchange=${exchange}&period=${rangeToIndicatorPeriod[range] ?? range}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error" }));
        setAbsorptionError(err.error ?? "Error");
        setAbsorptionSignals([]);
        return;
      }
      const d = await res.json();
      setAbsorptionSignals(d.absorption?.signals ?? []);
    } catch {
      setAbsorptionError("Network error");
      setAbsorptionSignals([]);
    } finally {
      setAbsorptionLoading(false);
    }
  }, [symbol, exchange, range]);


  useEffect(() => {
    loadVolumeProfile();
  }, [loadVolumeProfile]);

  useEffect(() => {
    loadDivergence();
  }, [loadDivergence]);

  useEffect(() => {
    loadImbalance();
  }, [loadImbalance]);

  useEffect(() => {
    loadAbsorption();
  }, [loadAbsorption]);

  useEffect(() => {
    loadDrawings();
  }, [loadDrawings]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/orderflow?range=${range}&symbol=${symbol}&exchange=${exchange}&tz=${timezone}`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        offRef.current = null;
        setData(d);
      } catch {
        // тихо
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [live, range, symbol, exchange, timezone]);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !data?.heatmap) return;
    const hm = data.heatmap;
    const candles = getMergedCandles();
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, W, H);

    const PP = PRICE_AXIS_W;
    const layout = computePlotLayout(W, H, PADB);
    const { plotX, plotW, plotH } = layout;
    layoutRef.current = { plotX, plotW, plotH };

    // fullT0 расширяется влево по мере догрузки истории (historyRef) — иначе
    // pan/zoom клэмпились бы по исходному окну data.from и не давали уйти
    // в уже подгруженную историю (см. LAZY_HISTORY_PLAN.md).
    const fullT0 = candles.length ? Math.min(data.from, candles[0].t) : data.from;
    const fullT1 = data.to;
    let fYMin = hm.priceMin;
    let fYMax = hm.priceMax;
    for (const k of candles) {
      if (k.l < fYMin) fYMin = k.l;
      if (k.h > fYMax) fYMax = k.h;
    }
    const candleStep = candles.length > 1 ? candles[1].t - candles[0].t : (fullT1 - fullT0) / 40;
    boundsRef.current = { t0: fullT0, t1: fullT1, y0: fYMin, y1: fYMax, step: candleStep };
    if (!viewRef.current) {
      const visible = VISIBLE_CANDLES[range] ?? DEFAULT_VISIBLE;
      viewRef.current = computeInitialView(candles, fullT0, fullT1, visible);
    }
    const v = viewRef.current;
    const t0 = v.t0;
    const t1 = v.t1;
    const yMin = v.y0;
    const yMax = v.y1;
    const xspan = t1 - t0 || 1;
    const sx = (ms: number) => plotX + ((ms - t0) / xspan) * plotW;
    const yspan = yMax - yMin || 1;
    const sy = (p: number) => plotH - ((p - yMin) / yspan) * plotH;

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, 0, plotW, plotH);
    ctx.clip();

    if (showLiq) {
      const key = `${data.from}:${data.to}:${minT}:${gamma}`;
      if (!offRef.current || offRef.current.key !== key) {
        offRef.current = { key, canvas: buildOffscreen(hm, minT, gamma) };
      }
      const hmX0 = sx(hm.times[0] ?? t0);
      const hmX1 = sx(hm.times[hm.cols - 1] ?? t1);
      const hmYTop = sy(hm.priceMax);
      const hmYBot = sy(hm.priceMin);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        offRef.current.canvas,
        0, 0, hm.cols, hm.bins,
        hmX0, hmYTop, Math.max(1, hmX1 - hmX0), Math.max(1, hmYBot - hmYTop),
      );
      ctx.imageSmoothingEnabled = true;

      if (hm.maxVal > 0) {
        const colSpanMs = ((hm.times[1] ?? t0) - (hm.times[0] ?? t0)) || xspan / hm.cols;
        const cellW = (colSpanMs / xspan) * plotW;
        const priceStep = (hm.priceMax - hm.priceMin) / hm.bins;
        const cellH = (priceStep / yspan) * plotH;
        if (cellW >= 14 && cellH >= 7) {
          ctx.font = `${Math.min(11, Math.max(7, cellH - 2))}px ui-sans-serif, system-ui`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          for (let c = 0; c < hm.cols; c++) {
            const x = sx(hm.times[c]);
            if (x < plotX - cellW || x > plotX + plotW + cellW) continue;
            const col = hm.grid[c];
            for (let b = 0; b < hm.bins; b++) {
              const val = col[b];
              if (val / hm.maxVal < 0.2) continue;
              if ((b > 0 && col[b - 1] > val) || (b < hm.bins - 1 && col[b + 1] > val)) continue;
              if ((hm.grid[c - 1]?.[b] ?? 0) > val || (hm.grid[c + 1]?.[b] ?? 0) > val) continue;
              const price = hm.priceMin + ((b + 0.5) / hm.bins) * (hm.priceMax - hm.priceMin);
              const y = sy(price);
              if (y < 0 || y > plotH) continue;
              ctx.fillStyle = "#0a0b10";
              ctx.fillText(fmtVal(val), x, y);
            }
          }
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
        }
      }
    }
    ctx.restore();

    if (hm.profileMax > 0) {
      const pb = hm.profileBid;
      const pa = hm.profileAsk;
      const hmSpan = hm.priceMax - hm.priceMin || 1;
      const binH = Math.max(1, plotH / hm.bins);
      for (let b = 0; b < hm.bins; b++) {
        const vol = pb[b] + pa[b];
        if (vol <= 0) continue;
        const priceC = hm.priceMin + ((b + 0.5) / hm.bins) * hmSpan;
        const y = sy(priceC);
        if (y < 0 || y > plotH) continue;
        const len = (vol / hm.profileMax) * (PP - 6);
        ctx.fillStyle = pb[b] >= pa[b] ? "rgba(22,199,132,0.75)" : "rgba(234,57,67,0.75)";
        ctx.fillRect(PADL, y - binH / 2, len, Math.max(1, binH));
      }
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(plotX - 1, 0);
      ctx.lineTo(plotX - 1, plotH);
      ctx.stroke();
    }

    drawPriceGrid(ctx, layout, yMin, yMax, sy);
    drawTimeGrid(ctx, layout, t0, t1, timezone, sx);

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, 0, plotW, plotH);
    ctx.clip();

    const fp = data.footprint;
    const colW = fp ? (fp.interval / xspan) * plotW : 0;
    if (clusters && fp && fp.maxVol > 0 && fp.candles.length) {
      const rowPx = colW >= 80 ? 12 : colW >= 50 ? 10 : colW >= 32 ? 8 : 6;
      const wickW = Math.min(3, Math.max(1, colW * 0.05));
      const maxBarW = Math.max(4, colW - wickW * 3 - wickW * 3 - 2);
      const showNums = rowPx >= 8;
      const fontPx = Math.min(11, Math.max(7, rowPx - 1));
      if (showNums) {
        ctx.font = `${fontPx}px ui-sans-serif, system-ui`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
      }
      for (const fc of fp.candles) {
        const x0 = sx(fc.t + fp.interval / 2);
        if (x0 < plotX - colW || x0 > plotX + plotW + colW) continue;
        const rows = new Map<number, { buy: number; sell: number }>();
        for (const lvl of fc.levels) {
          if (lvl.buy + lvl.sell <= 0) continue;
          const y = sy(lvl.price);
          if (y < -rowPx || y > plotH + rowPx) continue;
          const ri = Math.floor(y / rowPx);
          const r = rows.get(ri) ?? { buy: 0, sell: 0 };
          r.buy += lvl.buy; r.sell += lvl.sell;
          rows.set(ri, r);
        }
        let cMax = 0;
        for (const r of rows.values()) { const v = r.buy + r.sell; if (v > cMax) cMax = v; }
        if (cMax <= 0) continue;
        for (const [ri, r] of rows) {
          const vol = r.buy + r.sell;
          const len = Math.max(1, (vol / cMax) * maxBarW);
          const y = ri * rowPx;
          ctx.fillStyle = r.buy >= r.sell ? "rgba(15,136,90,0.6)" : "rgba(160,39,46,0.6)";
          ctx.fillRect(x0 + 1, y, len, Math.max(1, rowPx - 0.6));
          if (showNums) {
            const label = fmtVal(vol);
            const w = ctx.measureText(label).width;
            if (len >= w + 6) {
              ctx.fillStyle = "#f0f4fa";
              ctx.fillText(label, x0 + 4, y + rowPx / 2);
            }
          }
        }
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }

    drawCandlesticks(ctx, candles, sx, sy, plotX, plotW, xspan, { clusters, colW });
    if (!hasMoreHistoryRef.current && candles.length) {
      drawHistoryStartBoundary(ctx, sx(candles[0].t), layout, t("of.historyStart"));
    }
    ctx.restore();

    if (showDrawings && drawings.length) {
      const dd = drawingDragRef.current;
      const rs = drawingResizeRef.current;
      if (dd) {
        let adjusted: DrawingRow[];
        if (rs) {
          // RESIZE: используем новые точки напрямую (не offset)
          adjusted = drawings.map(d => {
            if (d.id !== dd.drawingId) return d;
            return { ...d, points: JSON.stringify(dd.originalPoints) };
          });
        } else {
          // DRAG: применяем смещение к оригинальным точкам
          adjusted = drawings.map(d => {
            if (d.id !== dd.drawingId) return d;
            try {
              const pts = JSON.parse(d.points) as DrawingPoint[];
              const shifted = pts.map(p => ({
                t: Math.round(p.t + dd.dx),
                price: p.price - dd.dy,
              }));
              return { ...d, points: JSON.stringify(shifted) };
            } catch { return d; }
          });
        }
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
        // Если магнит включён — рисуем preview к snapped позиции
        let x2 = hov.mx;
        let y2 = hov.my;
        if (magnet && snappedRef.current) {
          x2 = sx(snappedRef.current.t);
          y2 = sy(snappedRef.current.price);
        }
        ctx.save();
        ctx.strokeStyle = "#e6b800";
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

    if (showAbsorption && absorptionSignals.length) {
      drawAbsorptionMarkers(ctx, sx, sy, plotX, plotW, plotH, absorptionSignals, candles);
    }

    if (showDivergence && divergenceSignals.length) {
      // Дивергенция считается на сервере с более широким lookback, чем окно
      // реально загруженных свечей — метки старше первой загруженной свечи
      // фильтруем, иначе при зуме/панораме за пределы загруженных данных они
      // «висят» без свечей под собой.
      const firstCandleT = candles[0]?.t;
      const lastCandleT = candles[candles.length - 1]?.t;
      const visibleDivergenceSignals = firstCandleT !== undefined && lastCandleT !== undefined
        ? divergenceSignals.filter(s => s.t >= firstCandleT && s.t <= lastCandleT)
        : divergenceSignals;
      drawDivergenceMarkers(ctx, sx, sy, plotX, plotW, plotH, visibleDivergenceSignals);
    }

    const last = candles.length ? candles[candles.length - 1].c : hm.price;
    const yp = sy(last);
    drawLastPriceTag(ctx, last, yp, layout);

    const hov = hoverRef.current;
    if (hov && hov.mx >= plotX && hov.mx <= plotX + plotW && hov.my <= plotH) {
      // Если активен инструмент рисования и магнит — смещаем перекрестие к snapped позиции
      let cx = hov.mx;
      let cy = hov.my;
      if (activeTool && magnet && snappedRef.current) {
        cx = sx(snappedRef.current.t);
        cy = sy(snappedRef.current.price);
      }
      drawCrosshair(ctx, cx, cy, layout);
      // Если магнит активен — рисуем маркер притягивания
      if (activeTool && magnet && snappedRef.current) {
        ctx.fillStyle = "#e6b800";
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

      const hmX0 = sx(hm.times[0] ?? t0);
      const hmX1 = sx(hm.times[hm.cols - 1] ?? t1);
      const insideHeatmap =
        cx >= Math.min(hmX0, hmX1) && cx <= Math.max(hmX0, hmX1) &&
        priceH >= hm.priceMin && priceH <= hm.priceMax;
      const colIdx = Math.max(0, Math.min(hm.cols - 1,
        Math.floor(((cx - hmX0) / Math.max(1, hmX1 - hmX0)) * hm.cols)));
      const binIdx = Math.max(0, Math.min(hm.bins - 1, Math.floor(((priceH - hm.priceMin) / (hm.priceMax - hm.priceMin || 1)) * hm.bins)));
      const vol = insideHeatmap ? (hm.grid[colIdx]?.[binIdx] ?? 0) : 0;

      drawPriceCrosshairTag(ctx, priceH, cy, layout);

      const stepMs = candles.length > 1 ? candles[1].t - candles[0].t : 0;
      const cndl = stepMs ? candles.find((k) => ms >= k.t && ms < k.t + stepMs) : undefined;
      const timeLabel = fmtCrosshairLabel(cndl ? cndl.t : ms, timezone, locale);
      drawTimeCrosshairTag(ctx, timeLabel, cx, layout);

      const base = baseAsset(data.symbol);
      const hasWall = showLiq && insideHeatmap && hm.maxVal > 0 && vol / hm.maxVal >= minT;
      if (hasWall) {
        const lines = [
          t("of.tipLimitOrder"),
          `${fmtP(priceH)} · ${fmtVal(vol)} ${base}`,
        ];
        drawTooltipBox(ctx, lines, cx, cy, layout);
      }
    }
  }, [data, minT, gamma, clusters, showLiq, showDivergence, divergenceSignals, showAbsorption, absorptionSignals, showDrawings, drawings, selectedDrawingId, t, range, timezone, locale, activeTool, drawingPoints, magnet, getMergedCandles]);

  const drawDelta = useCallback(() => {
    const cv = deltaRef.current;
    if (!cv || !data) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    // Та же временная шкала (t0/t1), что у самих свечей (viewRef), БЕЗ
    // клэмпа к [data.from, data.to] — так подписи Δ/CVD всегда стоят под
    // теми же свечами по X, что и на графике выше (как на форекс-графике,
    // ForexView.tsx, где точно так же напрямую берётся viewRef). Раньше тут
    // был клэмп, растягивавший загруженный кусок дельты на всю ширину —
    // при виде шире окна [data.from,data.to] (zoom-out до предела, дозагрузка
    // истории свечей) это чинило "сжатую в полоску" дельту, но ценой сдвига
    // её относительно свечей ("начинается с середины"). Так честнее: если
    // дельты для части видимого диапазона нет — там просто пусто, а не
    // подрисованный кусок не в том месте.
    const t0 = viewRef.current?.t0 ?? data.from;
    const t1 = viewRef.current?.t1 ?? data.to;
    const viewingUnpaginatedHistory = t0 < data.from;
    const d = viewingUnpaginatedHistory ? null : data.delta;
    drawDeltaCvdChart(ctx, {
      W, H, t0, t1,
      times: d?.times ?? [],
      delta: d?.delta ?? [],
      cvd: d?.cvd ?? null,
      emptyText: viewingUnpaginatedHistory ? t("of.noDeltaHistory") : t("of.noDelta"),
    });
  }, [data, t, viewRef]);

  const drawBA = useCallback(() => {
    const cv = baRef.current;
    if (!cv || !data) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, W, H);

    // Та же шкала, что у свечей — без клэмпа к [data.from, data.to], см.
    // комментарий в drawDelta выше (то же самое решение и по той же причине:
    // клэмп чинил "сжатую полоску", но сдвигал B/A относительно свечей).
    const t0 = viewRef.current?.t0 ?? data.from;
    const t1 = viewRef.current?.t1 ?? data.to;
    const viewingUnpaginatedHistory = t0 < data.from;
    const ba = viewingUnpaginatedHistory ? null : data.ba;
    const plotX = 8 + 76;
    const plotW = W - plotX - 64;
    if (!ba || ba.full.length === 0) {
      ctx.fillStyle = "#6b7384";
      ctx.font = "11px ui-sans-serif, system-ui";
      ctx.fillText(viewingUnpaginatedHistory ? t("of.noBaHistory") : t("of.noBa"), plotX, H / 2);
      return;
    }
    const xspan = t1 - t0 || 1;
    const sx = (ms: number) => plotX + ((ms - t0) / xspan) * plotW;
    const sy = (v: number) => H - 4 - v * (H - 8);

    ctx.fillStyle = "rgba(22,199,132,0.06)";
    ctx.fillRect(plotX, sy(1), plotW, sy(0.5) - sy(1));
    ctx.fillStyle = "rgba(234,57,67,0.06)";
    ctx.fillRect(plotX, sy(0.5), plotW, sy(0) - sy(0.5));
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(plotX, sy(0.5));
    ctx.lineTo(plotX + plotW, sy(0.5));
    ctx.stroke();

    const line = (vals: number[], color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < vals.length; i++) {
        if (data.ba!.full[i] === 0.5 && data.ba!.near[i] === 0.5) continue;
        const x = sx(ba.times[i]);
        const y = sy(vals[i]);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
    };
    line(ba.full, "#5b8def");
    line(ba.near, "#e6b800");

    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillStyle = "#8a93a6";
    ctx.fillText("B/A", plotX + 2, 13);
    ctx.fillStyle = "#5b8def";
    ctx.fillText("full", plotX + plotW + 5, 13);
    ctx.fillStyle = "#e6b800";
    ctx.fillText("±1%", plotX + plotW + 5, 26);
  }, [data, t, viewRef]);

  useEffect(() => {
    draw();
    drawDelta();
    drawBA();
    const onResize = () => { draw(); drawDelta(); drawBA(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw, drawDelta, drawBA]);

  const redrawAll = useCallback(() => {
    draw();
    drawDelta();
    drawBA();
  }, [draw, drawDelta, drawBA]);
  useEffect(() => { redrawAllRef.current = redrawAll; }, [redrawAll]);

  // При смене пары/биржи/таймфрейма старый viewRef (масштаб цены/времени)
  // остаётся от прежнего инструмента, пока не придут новые данные — если
  // сбрасывать viewRef сразу в load() (до ответа fetch), возникает окно,
  // когда график рисуется вообще без view (пусто) до следующего пересчёта.
  // Сбрасываем и форсируем перерисовку здесь — в эффекте, который гарантированно
  // видит уже применённые свежие `candles` (не нужен двойной клик, чтобы починить).
  const lastResetKeyRef = useRef<string>("");
  useEffect(() => {
    if (!data) return;
    const key = `${data.symbol}|${data.exchange}|${data.range}`;
    if (key === lastResetKeyRef.current) return;
    lastResetKeyRef.current = key;
    viewRef.current = null;
    historyRef.current = [];
    hasMoreHistoryRef.current = true;
    setHistoryVersion((v) => v + 1);
    redrawAllRef.current();
  }, [data, viewRef, redrawAllRef]);

  // Принудительный перерисовка при изменении рисунков (saveDrawing асинхронный,
  // и может не успеть к моменту вызова draw() из эффекта выше)
  useEffect(() => {
    redrawAll();
  }, [drawings, redrawAll]);


  const hm = data?.heatmap ?? null;
  const SELECT = "input-base text-sm py-1.5 cursor-pointer";

  return (
    <div className="px-6 py-5 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Layers size={20} className="text-accent" />
            {t("of.title")}
          </h1>
          <p className="text-sm text-muted">{t("of.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={SELECT} value={symbol} onChange={(e) => setSymbol(e.target.value)} title={t("of.hintSymbol")}>
            {metaSymbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={SELECT} value={exchange} onChange={(e) => setExchange(e.target.value)} title={t("of.hintExchange")}>
            {metaExchanges.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select
            className={SELECT}
            value={range}
            onChange={(e) => setRange(e.target.value)}
            title={t("of.hintTimeframe")}
          >
            {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            onClick={() => setShowLiq((v) => !v)}
            className={`inline-flex items-center gap-1.5 input-base py-1.5 text-sm transition ${showLiq ? "text-accent border-accent/40" : "text-muted hover:border-border-strong"}`}
          >
            <span className={`h-3 w-3 rounded-sm border ${showLiq ? "bg-accent border-accent" : "border-border-strong"}`} />
            {t("of.showLiq")}
            <span title={t("of.hintShowLiq")} className="inline-flex cursor-help">
              <HelpCircle size={12} className="text-faint shrink-0" />
            </span>
          </button>
          <button
            onClick={() => setClusters((v) => !v)}
            className={`inline-flex items-center gap-1.5 input-base py-1.5 text-sm transition ${clusters ? "text-accent border-accent/40" : "text-muted hover:border-border-strong"}`}
          >
            <span className={`h-3 w-3 rounded-sm border ${clusters ? "bg-accent border-accent" : "border-border-strong"}`} />
            {t("of.clusters")}
            <span title={t("of.hintClusters")} className="inline-flex cursor-help">
              <HelpCircle size={12} className="text-faint shrink-0" />
            </span>
          </button>
          <button
            onClick={() => setShowDivergence((v) => !v)}
            className={`inline-flex items-center gap-1.5 input-base py-1.5 text-sm transition ${showDivergence ? "text-accent border-accent/40" : "text-muted hover:border-border-strong"}`}
            title={t("of.hintDivergence") || "Divergence Scanner — show/hide price vs delta divergence markers"}
          >
            <span className={`h-3 w-3 rounded-sm border ${showDivergence ? "bg-accent border-accent" : "border-border-strong"}`} />
            {t("of.divergence")}
            <span title={t("of.hintDivergence") || "Divergence Scanner — detects discrepancies between price movement and delta/CVD"} className="inline-flex cursor-help">
              <HelpCircle size={12} className="text-faint shrink-0" />
            </span>
          </button>
          <button
            onClick={() => setShowAbsorption((v) => !v)}
            className={`inline-flex items-center gap-1.5 input-base py-1.5 text-sm transition ${showAbsorption ? "text-accent border-accent/40" : "text-muted hover:border-border-strong"}`}
            title={t("of.hintAbsorption") || "Absorption Pattern Detector — narrow range + high volume + near-zero delta"}
          >
            <span className={`h-3 w-3 rounded-sm border ${showAbsorption ? "bg-accent border-accent" : "border-border-strong"}`} />
            {t("of.absorption")}
            <span title={t("of.hintAbsorption") || "Absorption — detects accumulation/distribution patterns"} className="inline-flex cursor-help">
              <HelpCircle size={12} className="text-faint shrink-0" />
            </span>
          </button>
          <button
            onClick={() => setLive((v) => !v)}
            className={`inline-flex items-center gap-1.5 input-base py-1.5 text-sm transition ${live ? "text-profit border-profit/40" : "text-muted hover:border-border-strong"}`}
          >
            <span className={`h-2 w-2 rounded-full ${live ? "bg-profit animate-pulse" : "bg-faint"}`} />
            LIVE
            <span title={t("of.hintLive")} className="inline-flex cursor-help">
              <HelpCircle size={12} className="text-faint shrink-0" />
            </span>
          </button>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 input-base py-1.5 hover:border-border-strong transition"
            title={t("of.hintRefresh")}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Слайдеры фильтрации */}
      <div className="flex flex-wrap items-center gap-6 mb-3 text-xs text-muted">
        <label className="flex items-center gap-2" title={t("of.hintMinSize")}>
          <span className="min-w-28 inline-flex items-center gap-1 whitespace-nowrap">
            {t("of.filterThreshold")}: {minPct}%
            <HelpCircle size={12} className="text-faint shrink-0" />
          </span>
          <input type="range" min={0} max={100} value={minPct} onChange={(e) => setMinPct(Number(e.target.value))} className="accent-accent w-40" />
        </label>
        <label className="flex items-center gap-2" title={t("of.hintBrightness")}>
          <span className="min-w-28 inline-flex items-center gap-1 whitespace-nowrap">
            {t("of.filterBrightness")}: {brightness}%
            <HelpCircle size={12} className="text-faint shrink-0" />
          </span>
          <input type="range" min={0} max={100} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="accent-accent w-40" />
        </label>
        {(() => {
          const thr =
            metaMinCoins[`${symbol.toUpperCase()}|${exchange.endsWith("-futures") ? "futures" : "spot"}`] ??
            bigLimitFor(symbol);
          if (thr === 0) return null;
          return (
            <span className="text-faint/80 inline-flex items-center gap-1.5">
              <Filter size={12} className="shrink-0" />
              {t("of.onlyBigLimits", { n: thr.toLocaleString("en-US"), coin: baseAsset(symbol) })}
            </span>
          );
        })()}
      </div>

      {error && <div className="card p-4 text-sm text-loss border-loss/30 mb-5">{error}</div>}

      {loading && !data ? (
        <div className="text-sm text-faint">{t("common.loading")}</div>
      ) : !hm ? (
        <div className="card p-10 text-center text-muted">{t("of.empty")}</div>
      ) : (
        <>
          <div className="card p-2 relative" style={{ background: "#0a0b10" }}>
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
                          const res = await fetch(`/api/orderflow/drawings?id=${d.id}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ color: newColor }),
                          });
                          if (res.ok) {
                            setDrawings(prev => prev.map(dd => dd.id === d.id ? { ...dd, color: newColor } : dd));
                          }
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
                          const res = await fetch(`/api/orderflow/drawings?id=${d.id}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ lineWidth: newWidth }),
                          });
                          if (res.ok) {
                            setDrawings(prev => prev.map(dd => dd.id === d.id ? { ...dd, lineWidth: newWidth } : dd));
                          }
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
                        const res = await fetch(`/api/orderflow/drawings?id=${d.id}`, { method: "DELETE" });
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
            <div className="flex gap-2 items-start">
              <DrawingToolbar activeTool={activeTool} onSelectTool={setActiveTool} magnet={magnet} onToggleMagnet={() => setMagnet(v => !v)} showDrawings={showDrawings} onToggleShowDrawings={() => setShowDrawings(v => !v)} />
              <div className="flex-1 min-w-0 relative">
                <canvas
                  ref={canvasRef}
                  className="w-full"
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
                    {t("of.loadingHistory")}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-1 border-t border-border/40 pt-1">
              <canvas ref={deltaRef} className="w-full" style={{ height: 110 }} />
            </div>
            <div className="mt-1 border-t border-border/40 pt-1">
              <canvas ref={baRef} className="w-full" style={{ height: 80 }} />
            </div>
          </div>
          <div className="mt-1 text-[11px] text-faint">{t("of.zoomHint")}</div>

          <div className="mt-3">
            <VolumeProfile data={vpData} loading={vpLoading} error={vpError} />
          </div>

          <ImbalanceHeatmap data={imbalanceData} loading={imbalanceLoading} error={imbalanceError} />

          <div className="mt-3">
            <DivergenceHistory signals={divergenceSignals} loading={divLoading} error={divError} />
          </div>

          <div className="mt-3">
            <AbsorptionPanel signals={absorptionSignals} loading={absorptionLoading} error={absorptionError} />
          </div>

          <div className="card p-3 mt-3">
            <div className="text-xs font-medium text-muted inline-flex items-center gap-1.5">
              {t("of.bigTrades")}
              <span title={t("of.bigTradesHint")} className="inline-flex cursor-help">
                <HelpCircle size={12} className="text-faint shrink-0" />
              </span>
            </div>
            <div className="text-[11px] text-faint mb-2">{t("of.bigTradesHint")}</div>
            {(data?.bigTrades?.length ?? 0) === 0 ? (
              <div className="text-xs text-faint">{t("of.noBig")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="text-faint text-left border-b border-border/50">
                      <th className="font-medium py-1 pr-3">
                        <span className="inline-flex items-center gap-1" title={t("of.thTradeTimeHint") || undefined}>
                          {t("of.thTime")} <HelpCircle size={10} className="text-faint shrink-0" />
                        </span>
                      </th>
                      <th className="font-medium py-1 pr-3">
                        <span className="inline-flex items-center gap-1" title={t("of.thExchangeHint") || undefined}>
                          {t("of.thExchange")} <HelpCircle size={10} className="text-faint shrink-0" />
                        </span>
                      </th>
                      <th className="font-medium py-1 pr-3">
                        <span className="inline-flex items-center gap-1" title={t("of.thSideHint") || undefined}>
                          {t("of.thSide")} <HelpCircle size={10} className="text-faint shrink-0" />
                        </span>
                      </th>
                      <th className="font-medium py-1 pr-3 text-right">
                        <span className="inline-flex items-center gap-1" title={t("of.thTradePriceHint") || undefined}>
                          {t("of.thPrice")} <HelpCircle size={10} className="text-faint shrink-0" />
                        </span>
                      </th>
                      <th className="font-medium py-1 pr-3 text-right">
                        <span className="inline-flex items-center gap-1" title={t("of.thSizeHint") || undefined}>
                          {t("of.thSize")}, {baseAsset(symbol)} <HelpCircle size={10} className="text-faint shrink-0" />
                        </span>
                      </th>
                      <th className="font-medium py-1 text-right">
                        <span className="inline-flex items-center gap-1" title={t("of.thValueHint") || undefined}>
                          {t("of.thValue")}, $ <HelpCircle size={10} className="text-faint shrink-0" />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.bigTrades.slice(0, 24).map((b, i) => (
                      <tr key={i} className="border-b border-border/20">
                        <td className="text-faint py-0.5 pr-3">{fmtTime(b.t, timezone)}</td>
                        <td className="text-faint/80 py-0.5 pr-3">{b.exchange}</td>
                        <td className={`py-0.5 pr-3 ${b.side === "buy" ? "text-profit" : "text-loss"}`}>
                          {b.side === "buy" ? "▲ " : "▼ "}{b.side === "buy" ? t("of.sideBuy") : t("of.sideSell")}
                        </td>
                        <td className="text-fg py-0.5 pr-3 text-right">{fmtP(b.price)}</td>
                        <td className="text-fg py-0.5 pr-3 text-right">{b.qty.toFixed(3)}</td>
                        <td className="text-faint py-0.5 text-right">{fmtVal(b.qty * b.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-faint">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-4 rounded-sm" style={{ background: "linear-gradient(90deg,rgba(200,200,210,0.1),rgba(235,235,245,0.95))" }} />
              {t("of.legendWalls")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-profit" /> /
              <span className="inline-block h-2 w-2 rounded-sm bg-loss" />
              {t("of.legendCandles")}
            </span>
            <span>{t("of.maxWall")}: {fmtVal(hm.maxVal)}</span>
            <span className="text-faint/70">{t("of.zoomHint")}</span>
          </div>

        </>
      )}
    </div>
  );
}