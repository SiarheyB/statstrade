"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Flame, RefreshCw, Maximize2 } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";
import { useI18n } from "@/lib/i18n/provider";

type Candle = { t: number; o: number; h: number; l: number; c: number };
type Heatmap = {
  priceMin: number; priceMax: number; bins: number; cols: number;
  grid: number[][]; maxVal: number; price: number; candles: Candle[];
};
type Resp = { exchange: string; symbol: string; tf: string; heatmap: Heatmap };

const EXCHANGES = ["all", "binance", "bybit", "okx"] as const;
const TFS = ["1d", "2d", "7d", "1M", "3M"] as const;
const FALLBACK_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];

const STOPS: [number, [number, number, number, number]][] = [
  [0.0, [15, 20, 40, 0]],
  [0.18, [45, 30, 95, 170]],
  [0.42, [150, 40, 140, 215]],
  [0.68, [240, 120, 40, 240]],
  [1.0, [250, 232, 90, 255]],
];
function ramp(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i][0]) {
      const [a0, c0] = STOPS[i - 1];
      const [a1, c1] = STOPS[i];
      const f = (x - a0) / (a1 - a0 || 1);
      const m = (j: number) => Math.round(c0[j] + (c1[j] - c0[j]) * f);
      return `rgba(${m(0)},${m(1)},${m(2)},${(c0[3] + (c1[3] - c0[3]) * f) / 255})`;
    }
  }
  return "rgba(250,232,90,1)";
}
function fmtP(p: number): string {
  if (p >= 1000) return Math.round(p).toLocaleString("en-US");
  if (p >= 1) return p.toFixed(2);
  return p.toPrecision(4);
}

type View = { x0: number; x1: number; y0: number; y1: number };

export default function LiqMapPage() {
  const { t } = useI18n();
  const [exchange, setExchange] = useState<string>("all");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [symbols, setSymbols] = useState<string[]>(FALLBACK_SYMBOLS);
  const [tf, setTf] = useState<string>("7d");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ x0: 0, x1: 1, y0: 0, y1: 1 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/liqmap/symbols");
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d.symbols) && d.symbols.length) setSymbols(d.symbols);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/liqmap?exchange=${exchange}&symbol=${symbol}&tf=${tf}`);
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Error");
        setData(null);
        return;
      }
      setData(d);
      viewRef.current = { x0: 0, x1: 1, y0: d.heatmap.priceMin, y1: d.heatmap.priceMax };
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [exchange, symbol, tf]);

  useEffect(() => {
    load();
  }, [load]);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !data) return;
    const hm = data.heatmap;
    const v = viewRef.current;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0a0d13";
    ctx.fillRect(0, 0, W, H);

    const padR = 64;
    const plotW = W - padR;
    const span = hm.priceMax - hm.priceMin || 1;
    const xspan = v.x1 - v.x0 || 1;
    const yspan = v.y1 - v.y0 || 1;
    const sx = (tfrac: number) => ((tfrac - v.x0) / xspan) * plotW;
    const sy = (p: number) => H - ((p - v.y0) / yspan) * H;

    // Heatmap cells (culled to the visible viewport).
    for (let c = 0; c < hm.cols; c++) {
      const tfL = c / hm.cols;
      const tfR = (c + 1) / hm.cols;
      if (tfR < v.x0 || tfL > v.x1) continue;
      const xL = sx(tfL);
      const xR = sx(tfR);
      const col = hm.grid[c];
      for (let b = 0; b < hm.bins; b++) {
        const val = col[b];
        if (!val) continue;
        const pL = hm.priceMin + (b / hm.bins) * span;
        const pH = hm.priceMin + ((b + 1) / hm.bins) * span;
        if (pH < v.y0 || pL > v.y1) continue;
        ctx.fillStyle = ramp(Math.sqrt(val / hm.maxVal));
        const yT = sy(pH);
        ctx.fillRect(xL, yT, xR - xL + 0.6, sy(pL) - yT + 0.6);
      }
    }

    // Price gridlines + labels.
    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.textAlign = "left";
    for (let i = 0; i <= 6; i++) {
      const price = v.y0 + (i / 6) * yspan;
      const y = H - (i / 6) * H;
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotW, y);
      ctx.stroke();
      ctx.fillStyle = "#7b8499";
      ctx.fillText(fmtP(price), plotW + 5, Math.min(H - 2, Math.max(9, y + 3)));
    }

    // Candlesticks.
    const n = hm.candles.length;
    const cw = Math.max(1, (plotW / (xspan * n)) * 0.6);
    for (let i = 0; i < n; i++) {
      const tfc = (i + 0.5) / n;
      if (tfc < v.x0 - 0.02 || tfc > v.x1 + 0.02) continue;
      const cd = hm.candles[i];
      const x = sx(tfc);
      const up = cd.c >= cd.o;
      ctx.strokeStyle = up ? "#16c784" : "#ea3943";
      ctx.fillStyle = up ? "#16c784" : "#ea3943";
      ctx.beginPath();
      ctx.moveTo(x, sy(cd.h));
      ctx.lineTo(x, sy(cd.l));
      ctx.stroke();
      const yo = sy(cd.o);
      const yc = sy(cd.c);
      ctx.fillRect(x - cw / 2, Math.min(yo, yc), cw, Math.max(1, Math.abs(yc - yo)));
    }

    // Current price line.
    const yp = sy(hm.price);
    if (yp >= 0 && yp <= H) {
      ctx.strokeStyle = "#e6b800";
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(0, yp);
      ctx.lineTo(plotW, yp);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#e6b800";
      ctx.fillText(fmtP(hm.price), plotW + 5, Math.min(H - 2, Math.max(9, yp + 3)));
    }
  }, [data]);

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    draw();
    window.addEventListener("resize", requestDraw);
    return () => window.removeEventListener("resize", requestDraw);
  }, [draw, requestDraw]);

  function clampX(v: View) {
    const span = Math.min(1, v.x1 - v.x0);
    if (v.x1 - v.x0 >= 1) { v.x0 = 0; v.x1 = 1; return; }
    if (v.x0 < 0) { v.x1 = span; v.x0 = 0; }
    if (v.x1 > 1) { v.x0 = 1 - span; v.x1 = 1; }
  }
  function clampY(v: View, lo: number, hi: number) {
    const full = hi - lo;
    const span = Math.min(full, v.y1 - v.y0);
    if (v.y1 - v.y0 >= full) { v.y0 = lo; v.y1 = hi; return; }
    if (v.y0 < lo) { v.y1 = lo + span; v.y0 = lo; }
    if (v.y1 > hi) { v.y0 = hi - span; v.y1 = hi; }
  }

  function onWheel(e: React.WheelEvent) {
    if (!data) return;
    e.preventDefault();
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const plotW = rect.width - 64;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const v = viewRef.current;
    const tf0 = v.x0 + (Math.min(mx, plotW) / plotW) * (v.x1 - v.x0);
    const price = v.y0 + (1 - my / rect.height) * (v.y1 - v.y0);
    const f = e.deltaY < 0 ? 1 / 1.15 : 1.15;
    v.x0 = tf0 - (tf0 - v.x0) * f;
    v.x1 = tf0 + (v.x1 - tf0) * f;
    v.y0 = price - (price - v.y0) * f;
    v.y1 = price + (v.y1 - price) * f;
    clampX(v);
    clampY(v, data.heatmap.priceMin, data.heatmap.priceMax);
    requestDraw();
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !data) return;
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const plotW = rect.width - 64;
    const v = viewRef.current;
    const dtf = ((e.clientX - dragRef.current.x) / plotW) * (v.x1 - v.x0);
    const dp = ((e.clientY - dragRef.current.y) / rect.height) * (v.y1 - v.y0);
    v.x0 -= dtf; v.x1 -= dtf;
    v.y0 += dp; v.y1 += dp;
    clampX(v);
    clampY(v, data.heatmap.priceMin, data.heatmap.priceMax);
    dragRef.current = { x: e.clientX, y: e.clientY };
    requestDraw();
  }
  function onPointerUp() {
    dragRef.current = null;
  }
  function resetView() {
    if (!data) return;
    viewRef.current = { x0: 0, x1: 1, y0: data.heatmap.priceMin, y1: data.heatmap.priceMax };
    requestDraw();
  }

  return (
    <div className="px-6 py-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Flame size={20} className="text-accent" />
          {t("liq.title")}
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={resetView}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg input-base text-sm hover:border-border-strong"
            title={t("liq.reset")}
          >
            <Maximize2 size={14} /> {t("liq.reset")}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg input-base text-sm hover:border-border-strong disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {t("liq.refresh")}
          </button>
        </div>
      </div>
      <p className="text-sm text-muted mt-1 mb-4">{t("liq.subtitle")}</p>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1">
          {EXCHANGES.map((e) => (
            <button
              key={e}
              onClick={() => setExchange(e)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-sm transition capitalize",
                exchange === e ? "bg-accent/15 text-accent" : "input-base text-muted hover:text-fg",
              )}
            >
              {e === "all" ? t("liq.all") : e}
            </button>
          ))}
        </div>
        <SearchSelect
          value={symbol}
          options={symbols}
          allLabel={symbol}
          hideAll
          placeholder={t("trades.searchSymbol")}
          onChange={(v) => setSymbol(v)}
        />
        <div className="flex gap-1 ml-auto">
          {TFS.map((f) => (
            <button
              key={f}
              onClick={() => setTf(f)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-sm transition",
                tf === f ? "bg-accent/15 text-accent" : "input-base text-muted hover:text-fg",
              )}
            >
              {t(`liq.tf.${f}`)}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="card p-10 text-center text-loss">{error}</div>
      ) : (
        <div className="relative rounded-xl overflow-hidden border border-border" style={{ background: "#0a0d13" }}>
          <canvas
            ref={canvasRef}
            className="w-full block touch-none cursor-grab active:cursor-grabbing"
            style={{ height: 480 }}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-faint bg-black/30">
              {t("common.loading")}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 mt-3 text-xs text-faint">
        <span>{t("liq.legendLow")}</span>
        <div
          className="h-2 flex-1 max-w-xs rounded-full"
          style={{ background: "linear-gradient(90deg, rgba(45,30,95,0.7), rgba(150,40,140,0.9), rgba(240,120,40,1), rgba(250,232,90,1))" }}
        />
        <span>{t("liq.legendHigh")}</span>
        <span className="ml-auto">{t("liq.zoomHint")}</span>
      </div>
      <p className="text-xs text-faint mt-2">{t("liq.disclaimer")}</p>
    </div>
  );
}
