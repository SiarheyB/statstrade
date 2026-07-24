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
const FALLBACK_EXCHANGES = ["binance-futures", "binance-spot"];
const FALLBACK_SYMBOLS = ["BTCUSDT", "ETHUSDT"];

const ZOOM_IN_LIMIT = 1;
const ZOOM_OUT_LIMIT = 2;

const BIG_LIMIT_COINS: Record<string, number> = { BTCUSDT: 500, ETHUSDT: 5000 };
const DEFAULT_BIG_LIMIT_COINS = 500;
function bigLimitFor(symbol: string): number {
  return BIG_LIMIT_COINS[symbol.toUpperCase()] ?? DEFAULT_BIG_LIMIT_COINS;
}

function fmtP(p: number): string {
  if (p >= 1000) return Math.round(p).toLocaleString("en-US");
  if (p >= 1) return p.toFixed(2);
  return p.toPrecision(4);
}
function fmtVal(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return String(Math.round(v));
}
function fmtTime(ms: number, tz: TimezoneId): string {
  const { h, mi } = zonedParts(ms, tz);
  const p = (z: number) => String(z).padStart(2, "0");
  return `${p(h)}:${p(mi)}`;
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
function fmtDate(ms: number, tz: TimezoneId): string {
  const { d, mo } = zonedParts(ms, tz);
  const p = (z: number) => String(z).padStart(2, "0");
  return `${p(d)}.${p(mo + 1)}`;
}
function dayKey(ms: number, tz: TimezoneId): number {
  const { y, mo, d } = zonedParts(ms, tz);
  return y * 10000 + mo * 100 + d;
}
function fmtDateTime(ms: number, tz: TimezoneId): string {
  const { d, mo, h, mi } = zonedParts(ms, tz);
  const p = (z: number) => String(z).padStart(2, "0");
  return `${p(d)}.${p(mo + 1)} ${p(h)}:${p(mi)}`;
}
function baseAsset(symbol: string): string {
  return symbol.replace(/(USDT|USDC|BUSD|USD|FDUSD)$/i, "") || symbol;
}

function niceStep(raw: number): number {
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
function niceTimeStep(xspan: number, maxLines = 8): number {
  for (const s of TIME_STEPS_MS) if (xspan / s <= maxLines) return s;
  return TIME_STEPS_MS[TIME_STEPS_MS.length - 1];
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
  const hoverRef = useRef<{ mx: number; my: number } | null>(null);
  const viewRef = useRef<{ t0: number; t1: number; y0: number; y1: number } | null>(null);
  const dragRef = useRef<({
    mx: number;
    my: number;
    mode: "pan" | "zoomX" | "zoomY";
    view: { t0: number; t1: number; y0: number; y1: number };
    drawingId?: string;
    originalPoints?: Array<{ t: number; price: number }>;
  }) | null>(null);
  const layoutRef = useRef<{ plotX: number; plotW: number; plotH: number } | null>(null);
  const boundsRef = useRef<{ t0: number; t1: number; y0: number; y1: number; step: number } | null>(null);
  const drawingDragRef = useRef<{ drawingId: string; dx: number; dy: number; originalPoints: DrawingPoint[] } | null>(null);
  const drawingResizeRef = useRef<{
    drawingId: string;
    cornerIdx: number; // 0=TL,1=TR,2=BL,3=BR
    // Исходные границы прямоугольника
    origMinT: number;
    origMaxT: number;
    origMinPrice: number;
    origMaxPrice: number;
    originalPoints: DrawingPoint[];
  } | null>(null);
  const snappedRef = useRef<{ t: number; price: number } | null>(null);

  const gamma = useMemo(() => 1 - (brightness / 100) * 0.8, [brightness]);
  const minT = useMemo(() => minPct / 100, [minPct]);

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
      viewRef.current = null;
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

  /** Привязка точки к haй/лою ближайшей свечи, если включён магнит. */
  function snapToCandle(t: number, price: number, candles: Candle[]): { t: number; price: number } {
    if (!magnet || !candles.length) return { t, price };
    // Ищем ближайшую свечу по времени
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
    const snapPriceThreshold = range * 0.3;
    const distHigh = Math.abs(price - nearest.h);
    const distLow = Math.abs(price - nearest.l);
    const snappedPrice = distHigh < snapPriceThreshold ? nearest.h : distLow < snapPriceThreshold ? nearest.l : price;
    return { t: nearest.t, price: snappedPrice };
  }

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

  const PADL = 8;
  const PADR = 64;
  const PADB = 20;

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !data?.heatmap) return;
    const hm = data.heatmap;
    const candles = data.candles ?? [];
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

    const PP = 76;
    const plotX = PADL + PP;
    const plotW = W - plotX - PADR;
    const plotH = H - PADB;
    layoutRef.current = { plotX, plotW, plotH };

    const fullT0 = data.from;
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
      const t0 = Math.max(fullT0, fullT1 - visible * candleStep);
      let vy0 = Infinity;
      let vy1 = -Infinity;
      for (const k of candles) {
        if (k.t < t0) continue;
        if (k.l < vy0) vy0 = k.l;
        if (k.h > vy1) vy1 = k.h;
      }
      if (!Number.isFinite(vy0) || !Number.isFinite(vy1)) {
        vy0 = fYMin;
        vy1 = fYMax;
      }
      const pad = (vy1 - vy0) * 0.04 || vy1 * 0.01;
      viewRef.current = { t0, t1: fullT1, y0: vy0 - pad, y1: vy1 + pad };
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

    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.textAlign = "left";
    const priceStep = niceStep(yspan / 6);
    const priceStart = Math.ceil(yMin / priceStep) * priceStep;
    for (let price = priceStart; price <= yMax; price += priceStep) {
      const y = sy(price);
      if (y < 0 || y > plotH) continue;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(plotX, y);
      ctx.lineTo(plotX + plotW, y);
      ctx.stroke();
      ctx.fillStyle = "#8a93a6";
      ctx.fillText(fmtP(price), plotX + plotW + 5, Math.min(plotH - 2, Math.max(9, y + 3)));
    }

    const timeStep = niceTimeStep(xspan);
    const timeStart = Math.ceil(t0 / timeStep) * timeStep;
    ctx.textAlign = "center";
    let lastDay: number | null = null;
    for (let ms = timeStart; ms <= t1; ms += timeStep) {
      const x = sx(ms);
      if (x < plotX || x > plotX + plotW) continue;
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, plotH);
      ctx.stroke();
      const day = dayKey(ms, timezone);
      const isDayStep = timeStep >= 86400000;
      const isNewDay = day !== lastDay;
      lastDay = day;
      const label = isDayStep ? fmtDate(ms, timezone) : isNewDay ? `${fmtDate(ms, timezone)} ${fmtTime(ms, timezone)}` : fmtTime(ms, timezone);
      ctx.fillStyle = isDayStep || isNewDay ? "#9aa2b3" : "#6b7384";
      ctx.fillText(label, x, H - 6);
    }
    ctx.textAlign = "left";

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

    if (candles.length > 1) {
      const stepMs = candles[1].t - candles[0].t;
      const wickW = clusters
        ? Math.min(3, Math.max(1, (stepMs / xspan) * plotW * 0.05))
        : 1;
      const cw = clusters
        ? wickW * 3
        : Math.max(1, (stepMs / xspan) * plotW * 0.7);
      ctx.lineWidth = wickW;
      for (const k of candles) {
        const x = sx(k.t + stepMs / 2);
        if (x < plotX - colW - 2 || x > plotX + plotW + colW + 2) continue;
        const up = k.c >= k.o;
        ctx.strokeStyle = up ? "#13af74" : "#ce323b";
        ctx.fillStyle = up ? "#13af74" : "#ce323b";
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
      drawDivergenceMarkers(ctx, sx, sy, plotX, plotW, plotH, divergenceSignals);
    }

    const last = candles.length ? candles[candles.length - 1].c : hm.price;
    const yp = sy(last);
    if (yp >= 0 && yp <= plotH) {
      ctx.strokeStyle = "#e6b800";
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(plotX, yp);
      ctx.lineTo(plotX + plotW, yp);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#e6b800";
      ctx.fillRect(plotX + plotW, yp - 7, PADR, 14);
      ctx.fillStyle = "#08080d";
      ctx.fillText(fmtP(last), plotX + plotW + 5, yp + 3);
    }

    const hov = hoverRef.current;
    if (hov && hov.mx >= plotX && hov.mx <= plotX + plotW && hov.my <= plotH) {
      // Если активен инструмент рисования и магнит — смещаем перекрестие к snapped позиции
      let cx = hov.mx;
      let cy = hov.my;
      if (activeTool && magnet && snappedRef.current) {
        cx = sx(snappedRef.current.t);
        cy = sy(snappedRef.current.price);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, plotH);
      ctx.moveTo(plotX, cy);
      ctx.lineTo(plotX + plotW, cy);
      ctx.stroke();
      ctx.setLineDash([]);
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

      ctx.fillStyle = "#e6b800";
      ctx.fillRect(plotX + plotW, cy - 7, PADR, 14);
      ctx.fillStyle = "#08080d";
      ctx.fillText(fmtP(priceH), plotX + plotW + 5, cy + 3);

      const stepMs = candles.length > 1 ? candles[1].t - candles[0].t : 0;
      const cndl = stepMs ? candles.find((k) => ms >= k.t && ms < k.t + stepMs) : undefined;
      const timeLabel = fmtCrosshairLabel(cndl ? cndl.t : ms, timezone, locale);
      ctx.font = "11px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      const timeBoxW = Math.ceil(ctx.measureText(timeLabel).width) + 12;
      const timeBoxX = Math.min(plotX + plotW - timeBoxW / 2, Math.max(plotX + timeBoxW / 2, cx));
      ctx.fillStyle = "#e6b800";
      ctx.fillRect(timeBoxX - timeBoxW / 2, plotH, timeBoxW, PADB - 1);
      ctx.fillStyle = "#08080d";
      ctx.fillText(timeLabel, timeBoxX, H - 6);
      ctx.textAlign = "left";

      const base = baseAsset(data.symbol);
      const hasWall = showLiq && insideHeatmap && hm.maxVal > 0 && vol / hm.maxVal >= minT;
      if (hasWall) {
        const lines = [
          t("of.tipLimitOrder"),
          `${fmtP(priceH)} · ${fmtVal(vol)} ${base}`,
        ];
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
        if (bx + boxW > plotX + plotW) bx = cx - boxW - 16;
        if (by + boxH > plotH) by = cy - boxH - 16;
        ctx.fillStyle = "rgba(16,18,26,0.96)";
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.fillRect(bx, by, boxW, boxH);
        ctx.strokeRect(bx, by, boxW, boxH);
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#e6eaf2";
        lines.forEach((ln, i) => ctx.fillText(ln, bx + padX, by + padY + lineH / 2 + i * lineH));
        ctx.textBaseline = "alphabetic";
      }
    }
  }, [data, minT, gamma, clusters, showLiq, showDivergence, divergenceSignals, showAbsorption, absorptionSignals, showDrawings, drawings, selectedDrawingId, t, range, timezone, locale, activeTool, drawingPoints, magnet]);

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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, W, H);

    const d = data.delta;
    const plotX = 8 + 76;
    const plotW = W - plotX - 64;
    if (!d || d.delta.length === 0) {
      ctx.fillStyle = "#6b7384";
      ctx.font = "11px ui-sans-serif, system-ui";
      ctx.fillText(t("of.noDelta"), plotX, H / 2);
      return;
    }
    const t0 = viewRef.current?.t0 ?? data.from;
    const t1 = viewRef.current?.t1 ?? data.to;
    const xspan = t1 - t0 || 1;
    const sx = (ms: number) => plotX + ((ms - t0) / xspan) * plotW;

    const n = d.delta.length;
    const maxAbs = Math.max(1, ...d.delta.map((v) => Math.abs(v)));
    const mid = H / 2;
    const bw = Math.max(1, (plotW / n) * 0.8);
    for (let i = 0; i < n; i++) {
      const v = d.delta[i];
      if (v === 0) continue;
      const x = sx(d.times[i]);
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

    const cvdMin = Math.min(...d.cvd);
    const cvdMax = Math.max(...d.cvd);
    const cspan = cvdMax - cvdMin || 1;
    const cy = (v: number) => H - 4 - ((v - cvdMin) / cspan) * (H - 8);
    ctx.strokeStyle = "#e6b800";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = sx(d.times[i]);
      const y = cy(d.cvd[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;

    ctx.fillStyle = "#8a93a6";
    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.fillText("Δ / CVD", plotX + 2, 12);
    ctx.fillStyle = "#e6b800";
    ctx.fillText(`CVD ${d.cvd[n - 1] >= 0 ? "+" : "-"}${fmtVal(Math.abs(d.cvd[n - 1]))}`, plotX + plotW + 5, 12);
  }, [data, t]);

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

    const ba = data.ba;
    const plotX = 8 + 76;
    const plotW = W - plotX - 64;
    if (!ba || ba.full.length === 0) {
      ctx.fillStyle = "#6b7384";
      ctx.font = "11px ui-sans-serif, system-ui";
      ctx.fillText(t("of.noBa"), plotX, H / 2);
      return;
    }
    const t0 = viewRef.current?.t0 ?? data.from;
    const t1 = viewRef.current?.t1 ?? data.to;
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

    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.fillStyle = "#8a93a6";
    ctx.fillText("B/A", plotX + 2, 12);
    ctx.fillStyle = "#5b8def";
    ctx.fillText("full", plotX + plotW + 5, 12);
    ctx.fillStyle = "#e6b800";
    ctx.fillText("±1%", plotX + plotW + 5, 24);
  }, [data, t]);

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

  // Принудительный перерисовка при изменении рисунков (saveDrawing асинхронный,
  // и может не успеть к моменту вызова draw() из эффекта выше)
  useEffect(() => {
    redrawAll();
  }, [drawings, redrawAll]);

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    hoverRef.current = { mx, my };
    const drag = dragRef.current;
    const lay = layoutRef.current;
    if (activeTool && lay && mx >= lay.plotX && mx <= lay.plotX + lay.plotW && my >= 0 && my <= lay.plotH) {
      const cv = canvasRef.current;
      if (cv) cv.style.cursor = "crosshair";
      // Обновляем snappedRef для preview-линии
      if (data?.candles) {
        const v = viewRef.current;
        if (v) {
          const xspan = v.t1 - v.t0 || 1;
          const yspan = v.y1 - v.y0 || 1;
          const t = v.t0 + ((mx - lay.plotX) / lay.plotW) * xspan;
          const price = v.y1 - (my / lay.plotH) * yspan;
          snappedRef.current = snapToCandle(t, price, data.candles);
        }
      } else {
        snappedRef.current = null;
      }
      draw();
      return;
    }
    if (drag && lay) {
      // Check if we're dragging a selected drawing
      if (dragRef.current?.drawingId) {
        const v = viewRef.current;
        if (v) {
          const xspan = v.t1 - v.t0 || 1;
          const yspan = v.y1 - v.y0 || 1;
          const cv = canvasRef.current;
          // === RESIZE прямоугольника ===
          if (drawingResizeRef.current) {
            // Вычисляем позицию мыши в координатах графика
            let tChart = v.t0 + ((mx - lay.plotX) / lay.plotW) * xspan;
            let priceChart = v.y1 - (my / lay.plotH) * yspan;
            if (magnet && data?.candles?.length) {
              const snapped = snapToCandle(tChart, priceChart, data.candles);
              snappedRef.current = snapped;
              tChart = snapped.t;
              priceChart = snapped.price;
            }
            const rs = drawingResizeRef.current;
            // Вычисляем новые границы прямоугольника
            let newT1: number, newT2: number, newP1: number, newP2: number;
            switch (rs.cornerIdx) {
              case 0: // TL — фиксирован BR
                newT1 = Math.round(tChart); newT2 = rs.origMaxT;
                newP1 = priceChart; newP2 = rs.origMinPrice;
                break;
              case 1: // TR — фиксирован BL
                newT1 = rs.origMinT; newT2 = Math.round(tChart);
                newP1 = priceChart; newP2 = rs.origMinPrice;
                break;
              case 2: // BL — фиксирован TR
                newT1 = Math.round(tChart); newT2 = rs.origMaxT;
                newP1 = rs.origMaxPrice; newP2 = priceChart;
                break;
              default: // 3 BR — фиксирован TL
                newT1 = rs.origMinT; newT2 = Math.round(tChart);
                newP1 = rs.origMaxPrice; newP2 = priceChart;
                break;
            }
            drawingDragRef.current = {
              drawingId: drawingResizeRef.current.drawingId,
              dx: 0, dy: 0,
              originalPoints: [{ t: newT1, price: newP1 }, { t: newT2, price: newP2 }],
            };
            if (cv) cv.style.cursor = "nwse-resize";
            draw();
            return;
          }
          // Смещение в координатах графика от начальной точки
          const dx = (mx - drag.mx) / lay.plotW * xspan;
          const dy = (my - drag.my) / lay.plotH * yspan;
          // Если магнит включён — притягиваем опорную точку рисунка к свече
          if (magnet && data?.candles?.length) {
            const orig = dragRef.current.originalPoints ?? [];
            if (orig.length > 0) {
              const anchor = orig[0];
              const endT = anchor.t + dx;
              const endPrice = anchor.price - dy;
              const snapped = snapToCandle(endT, endPrice, data.candles);
              // Пересчитываем offset так, чтобы опорная точка оказалась на snapped позиции
              const snappedDx = snapped.t - anchor.t;
              const snappedDy = anchor.price - snapped.price;
              // Ещё раз обновляем snappedRef (для отрисовки маркера)
              snappedRef.current = snapped;
              drawingDragRef.current = {
                drawingId: dragRef.current.drawingId,
                dx: snappedDx,
                dy: snappedDy,
                originalPoints: dragRef.current.originalPoints ?? [],
              };
              draw();
              return;
            }
          }
          drawingDragRef.current = {
            drawingId: dragRef.current.drawingId,
            dx,
            dy,
            originalPoints: dragRef.current.originalPoints ?? [],
          };
          draw();
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
        viewRef.current = { ...drag.view, t0: cx - span / 2, t1: cx + span / 2 };
      } else {
        const dt = ((mx - drag.mx) / lay.plotW) * (drag.view.t1 - drag.view.t0);
        const dp = ((my - drag.my) / lay.plotH) * (drag.view.y1 - drag.view.y0);
        viewRef.current = {
          t0: drag.view.t0 - dt,
          t1: drag.view.t1 - dt,
          y0: drag.view.y0 + dp,
          y1: drag.view.y1 + dp,
        };
      }
      redrawAll();
    } else {
      const lay2 = layoutRef.current;
      const cv = canvasRef.current;
      if (lay2 && cv) {
        if (!activeTool && drawings.length > 0) {
          const v = viewRef.current;
          if (v) {
            const xspan = v.t1 - v.t0 || 1;
            const yspan = v.y1 - v.y0 || 1;
            const sxLocal = (ms: number) => lay2.plotX + ((ms - v.t0) / xspan) * lay2.plotW;
            const syLocal = (p: number) => lay2.plotH - ((p - v.y0) / yspan) * lay2.plotH;
            const hit = findDrawingAt(mx, my, drawings, sxLocal, syLocal, lay2.plotX, lay2.plotW, lay2.plotH);
            if (hit) {
              // Если это угол прямоугольника — курсор resize
              if (hit.pointIdx >= 0 && hit.pointIdx <= 3) {
                cv.style.cursor = "nwse-resize";
              } else {
                cv.style.cursor = "pointer";
              }
            } else {
              // Даже если есть рисунки, на краях графика показываем resize-курсоры
              cv.style.cursor =
                mx >= lay2.plotX + lay2.plotW ? "ns-resize" : my >= lay2.plotH - 8 ? "ew-resize" : "default";
            }
          }
        } else {
          cv.style.cursor =
            mx >= lay2.plotX + lay2.plotW ? "ns-resize" : my >= lay2.plotH - 8 ? "ew-resize" : "default";
        }
      }
      draw();
    }
  }
  function onLeave() {
    hoverRef.current = null;
    dragRef.current = null;
    drawingResizeRef.current = null;
    draw();
  }
  function onDown(e: React.MouseEvent<HTMLCanvasElement>) {
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

    if (activeTool && mx >= lay.plotX && mx <= lay.plotX + lay.plotW && my >= 0 && my <= lay.plotH) {
      const v = viewRef.current;
      if (!v) return;
      const xspan = v.t1 - v.t0 || 1;
      const yspan = v.y1 - v.y0 || 1;
      const t = v.t0 + ((mx - lay.plotX) / lay.plotW) * xspan;
      const price = v.y1 - (my / lay.plotH) * yspan;
      const candles = data?.candles ?? [];
      const snapped = snapToCandle(t, price, candles);

      if (activeTool === "horizontal_line" || activeTool === "horizontal_ray") {
        saveDrawing(activeTool, [{ t: Math.round(snapped.t), price: snapped.price }]);
        setActiveTool(null);
        return;
      }

      if (drawingPoints.length === 0) {
        setDrawingPoints([{ t: Math.round(snapped.t), price: snapped.price }]);
      } else {
        saveDrawing(activeTool, [...drawingPoints, { t: Math.round(snapped.t), price: snapped.price }]);
        setDrawingPoints([]);
        setActiveTool(null);
      }
      return;
    }

    if (!activeTool && drawings.length > 0 && mx >= lay.plotX && mx <= lay.plotX + lay.plotW && my >= 0 && my <= lay.plotH) {
      const v = viewRef.current;
      if (v) {
        const xspan = v.t1 - v.t0 || 1;
        const yspan = v.y1 - v.y0 || 1;
        const sxLocal = (ms: number) => lay.plotX + ((ms - v.t0) / xspan) * lay.plotW;
        const syLocal = (p: number) => lay.plotH - ((p - v.y0) / yspan) * lay.plotH;
        const hit = findDrawingAt(mx, my, drawings, sxLocal, syLocal, lay.plotX, lay.plotW, lay.plotH);
        if (hit) {
          setSelectedDrawingId(hit.id);
          setShowDrawingEditor(true);
          const hitDrawing = drawings.find(d => d.id === hit.id);
          let originalPoints: DrawingPoint[] = [];
          if (hitDrawing?.points) {
            try { originalPoints = JSON.parse(hitDrawing.points); } catch { /* ignore */ }
          }
          drawingDragRef.current = null;
          drawingResizeRef.current = null;
          // Если это прямоугольник и клик по углу — запускаем resize
          if (hitDrawing?.toolType === "rectangle" && hit.pointIdx >= 0 && hit.pointIdx <= 3 && originalPoints.length >= 2) {
            const minT = Math.min(originalPoints[0].t, originalPoints[1].t);
            const maxT = Math.max(originalPoints[0].t, originalPoints[1].t);
            const minPrice = Math.min(originalPoints[0].price, originalPoints[1].price);
            const maxPrice = Math.max(originalPoints[0].price, originalPoints[1].price);
            drawingResizeRef.current = {
              drawingId: hit.id,
              cornerIdx: hit.pointIdx,
              origMinT: minT,
              origMaxT: maxT,
              origMinPrice: minPrice,
              origMaxPrice: maxPrice,
              originalPoints,
            };
            if (!dragRef.current) {
              dragRef.current = { mx, my, mode: "pan", view: { ...v }, drawingId: hit.id, originalPoints };
            }
            return;
          }
          // Иначе — обычный drag всего рисунка
          if (!dragRef.current) {
            dragRef.current = { mx, my, mode: "pan", view: { ...v }, drawingId: hit.id, originalPoints };
          }
          return;
        }
      }
    }
    if (selectedDrawingId && !activeTool) {
      setSelectedDrawingId(null);
      setShowDrawingEditor(false);
      drawingResizeRef.current = null;
    }

    if (viewRef.current) {
      const v2 = viewRef.current;
      const mode2: "pan" | "zoomX" | "zoomY" =
        lay && mx >= lay.plotX + lay.plotW ? "zoomY" : lay && my >= lay.plotH - 8 ? "zoomX" : "pan";
      dragRef.current = { mx, my, mode: mode2, view: { ...v2 } };
    }
  }
  function onUp() {
    const dd = drawingDragRef.current;
    const rs = drawingResizeRef.current;
    if (dd && dd.originalPoints.length > 0) {
      if (rs) {
        // RESIZE: точки уже содержат новые координаты (не offset)
        updateDrawing(dd.drawingId, dd.originalPoints);
        setDrawings(prev => prev.map(d =>
          d.id === dd.drawingId
            ? { ...d, points: JSON.stringify(dd.originalPoints) }
            : d
        ));
      } else {
        // DRAG: применяем offset к исходным точкам
        const newPoints = dd.originalPoints.map(p => ({
          t: Math.round(p.t + dd.dx),
          price: p.price - dd.dy,
        }));
        updateDrawing(dd.drawingId, newPoints);
        setDrawings(prev => prev.map(d =>
          d.id === dd.drawingId
            ? { ...d, points: JSON.stringify(newPoints) }
            : d
        ));
      }
    }
    drawingDragRef.current = null;
    drawingResizeRef.current = null;
    dragRef.current = null;
  }
  function onDouble() {
    viewRef.current = null;
    redrawAll();
  }

  useEffect(() => {
    const cv = canvasRef.current;
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
      viewRef.current = next;
      redrawAll();
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [redrawAll]);

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
            onClick={() => setShowDrawings((v) => !v)}
            className={`inline-flex items-center gap-1.5 input-base py-1.5 text-sm transition ${showDrawings ? "text-accent border-accent/40" : "text-muted hover:border-border-strong"}`}
            title={t("of.hintDrawings") || "Drawings — show/hide chart drawings"}
          >
            <span className={`h-3 w-3 rounded-sm border ${showDrawings ? "bg-accent border-accent" : "border-border-strong"}`} />
            {t("of.drawings") || "Drawings"}
            <span title={t("of.hintDrawings") || "Drawings — trend lines, horizontal lines, rectangles"} className="inline-flex cursor-help">
              <HelpCircle size={12} className="text-faint shrink-0" />
            </span>
          </button>
          <button
            onClick={() => setShowDivergence((v) => !v)}
            className={`inline-flex items-center gap-1.5 input-base py-1.5 text-sm transition ${showDivergence ? "text-accent border-accent/40" : "text-muted hover:border-border-strong"}`}
            title={t("of.hintDivergence") || "Divergence Scanner — show/hide price vs delta divergence markers"}
          >
            <span className={`h-3 w-3 rounded-sm border ${showDivergence ? "bg-accent border-accent" : "border-border-strong"}`} />
            Divergence
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
            Absorption
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
          <span className="w-28 inline-flex items-center gap-1">
            {t("of.filterThreshold")}: {minPct}%
            <HelpCircle size={12} className="text-faint shrink-0" />
          </span>
          <input type="range" min={0} max={100} value={minPct} onChange={(e) => setMinPct(Number(e.target.value))} className="accent-accent w-40" />
        </label>
        <label className="flex items-center gap-2" title={t("of.hintBrightness")}>
          <span className="w-28 inline-flex items-center gap-1">
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
            <div className="flex gap-2">
              <DrawingToolbar activeTool={activeTool} onSelectTool={setActiveTool} magnet={magnet} onToggleMagnet={() => setMagnet(v => !v)} />
              <div className="flex-1 min-w-0">
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
            <div className="text-xs font-medium text-muted">{t("of.bigTrades")}</div>
            <div className="text-[11px] text-faint mb-2">{t("of.bigTradesHint")}</div>
            {(data?.bigTrades?.length ?? 0) === 0 ? (
              <div className="text-xs text-faint">{t("of.noBig")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="text-faint text-left border-b border-border/50">
                      <th className="font-medium py-1 pr-3">{t("of.thTime")}</th>
                      <th className="font-medium py-1 pr-3">{t("of.thExchange")}</th>
                      <th className="font-medium py-1 pr-3">{t("of.thSide")}</th>
                      <th className="font-medium py-1 pr-3 text-right">{t("of.thPrice")}</th>
                      <th className="font-medium py-1 pr-3 text-right">{t("of.thSize")}, {baseAsset(symbol)}</th>
                      <th className="font-medium py-1 text-right">{t("of.thValue")}, $</th>
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