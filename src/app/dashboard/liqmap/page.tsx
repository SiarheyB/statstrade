"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Flame, RefreshCw, Maximize2 } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";
import { useI18n } from "@/lib/i18n/provider";

type Candle = { t: number; o: number; h: number; l: number; c: number };
type Heatmap = {
  priceMin: number; priceMax: number; bins: number; cols: number;
  grid: number[][]; maxVal: number; price: number; candles: Candle[];
};
type Resp = { exchange: string; symbol: string; tf: string; heatmap: Heatmap };

const EXCHANGES = ["binance", "bybit", "okx"] as const;
const TFS = ["1d", "2d", "7d", "1M", "3M"] as const;
const FALLBACK_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];

// Viridis palette (dark purple → blue → teal → green → yellow), opaque — matches
// the CoinGlass look where the whole field is coloured, bright = more liquidity.
const STOPS: [number, [number, number, number]][] = [
  [0.0, [68, 1, 84]],
  [0.25, [59, 82, 139]],
  [0.5, [33, 145, 140]],
  [0.75, [94, 201, 98]],
  [1.0, [253, 231, 37]],
];
function rampRgb(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i][0]) {
      const [a0, c0] = STOPS[i - 1];
      const [a1, c1] = STOPS[i];
      const f = (x - a0) / (a1 - a0 || 1);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return [253, 231, 37];
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
function fmtDT(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type View = { x0: number; x1: number; y0: number; y1: number };

// Render the grid into a cols×bins offscreen canvas (row 0 = top = high price);
// drawImage then scales it up with bilinear smoothing for the soft band look.
function buildOffscreen(hm: Heatmap): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = hm.cols;
  cv.height = hm.bins;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(hm.cols, hm.bins);
  for (let c = 0; c < hm.cols; c++) {
    const col = hm.grid[c];
    for (let b = 0; b < hm.bins; b++) {
      const t = hm.maxVal ? Math.sqrt(col[b] / hm.maxVal) : 0;
      const [r, g, bl] = rampRgb(t);
      const row = hm.bins - 1 - b; // high price at top
      const idx = (row * hm.cols + c) * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = bl;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export default function LiqMapPage() {
  const { t } = useI18n();
  const [exchange, setExchange] = useState<string>("binance");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [symbols, setSymbols] = useState<string[]>(FALLBACK_SYMBOLS);
  const [tf, setTf] = useState<string>("7d");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ x0: 0, x1: 1, y0: 0, y1: 1 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const hoverRef = useRef<{ mx: number; my: number } | null>(null);
  const offRef = useRef<{ src: Resp; canvas: HTMLCanvasElement } | null>(null);
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
      offRef.current = null;
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

  const PADL = 56;
  const PADR = 64;
  const PADB = 20;

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
    ctx.fillStyle = "#08080d";
    ctx.fillRect(0, 0, W, H);

    const plotX = PADL;
    const plotW = W - PADL - PADR;
    const plotH = H - PADB;
    const span = hm.priceMax - hm.priceMin || 1;
    const xspan = v.x1 - v.x0 || 1;
    const yspan = v.y1 - v.y0 || 1;
    const sx = (tfrac: number) => plotX + ((tfrac - v.x0) / xspan) * plotW;
    const sy = (p: number) => plotH - ((p - v.y0) / yspan) * plotH;

    // Heatmap via offscreen → smooth bilinear scaling of the visible window.
    if (!offRef.current || offRef.current.src !== data) {
      offRef.current = { src: data, canvas: buildOffscreen(hm) };
    }
    const off = offRef.current.canvas;
    const srcX = v.x0 * hm.cols;
    const srcW = xspan * hm.cols;
    const srcY = ((hm.priceMax - v.y1) / span) * hm.bins;
    const srcH = (yspan / span) * hm.bins;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, srcX, srcY, srcW, srcH, plotX, 0, plotW, plotH);

    // Price gridlines + labels (right).
    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.textAlign = "left";
    for (let i = 0; i <= 6; i++) {
      const price = v.y0 + (i / 6) * yspan;
      const y = plotH - (i / 6) * plotH;
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(plotX, y);
      ctx.lineTo(plotX + plotW, y);
      ctx.stroke();
      ctx.fillStyle = "#9aa3b5";
      ctx.fillText(fmtP(price), plotX + plotW + 5, Math.min(plotH - 2, Math.max(9, y + 3)));
    }

    // X-axis time labels.
    ctx.textAlign = "center";
    ctx.fillStyle = "#7b8499";
    const n = hm.candles.length;
    for (let i = 0; i <= 6; i++) {
      const tfrac = v.x0 + (i / 6) * xspan;
      const ci = Math.max(0, Math.min(n - 1, Math.floor(tfrac * n)));
      const x = sx(tfrac);
      if (x < plotX - 1 || x > plotX + plotW + 1) continue;
      const d = new Date(hm.candles[ci].t);
      const p = (z: number) => String(z).padStart(2, "0");
      ctx.fillText(`${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`, x, H - 6);
    }
    ctx.textAlign = "left";

    // Candlesticks.
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
    if (yp >= 0 && yp <= plotH) {
      ctx.strokeStyle = "#e6b800";
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(plotX, yp);
      ctx.lineTo(plotX + plotW, yp);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#e6b800";
      ctx.fillText(fmtP(hm.price), plotX + plotW + 5, Math.min(plotH - 2, Math.max(9, yp + 3)));
    }

    // Vertical colour scale (left).
    const barX = 10;
    const barW = 10;
    for (let yy = 0; yy < plotH; yy++) {
      const tt = 1 - yy / plotH;
      const [r, g, b] = rampRgb(tt);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(barX, yy, barW, 1);
    }
    ctx.fillStyle = "#9aa3b5";
    ctx.textAlign = "left";
    ctx.fillText(fmtVal(hm.maxVal), barX + barW + 3, 9);
    ctx.fillText("0", barX + barW + 3, plotH - 2);

    // Crosshair + info box.
    const hov = hoverRef.current;
    if (hov && hov.mx >= plotX && hov.mx <= plotX + plotW && hov.my <= plotH) {
      const tfh = v.x0 + ((hov.mx - plotX) / plotW) * xspan;
      const priceH = v.y0 + (1 - hov.my / plotH) * yspan;
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hov.mx, 0);
      ctx.lineTo(hov.mx, plotH);
      ctx.moveTo(plotX, hov.my);
      ctx.lineTo(plotX + plotW, hov.my);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#cdd3df";
      ctx.fillText(fmtP(priceH), plotX + plotW + 5, Math.min(plotH - 2, Math.max(9, hov.my + 3)));

      const ci = Math.max(0, Math.min(n - 1, Math.floor(tfh * n)));
      const colIdx = Math.max(0, Math.min(hm.cols - 1, Math.floor(tfh * hm.cols)));
      const binIdx = Math.max(0, Math.min(hm.bins - 1, Math.floor(((priceH - hm.priceMin) / span) * hm.bins)));
      const val = hm.grid[colIdx]?.[binIdx] ?? 0;
      const rows: [string, string][] = [
        [fmtDT(hm.candles[ci].t), ""],
        [t("liq.tipPrice"), fmtP(priceH)],
        [t("liq.tipLiq"), fmtVal(val)],
      ];
      const boxW = 188;
      const boxH = 16 + rows.length * 15;
      let bx = hov.mx + 14;
      let by = hov.my + 14;
      if (bx + boxW > plotX + plotW) bx = hov.mx - boxW - 14;
      if (by + boxH > plotH) by = plotH - boxH - 4;
      if (bx < plotX) bx = plotX + 4;
      if (by < 0) by = 4;
      ctx.fillStyle = "rgba(10,12,18,0.94)";
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e6e9f0";
      ctx.font = "12px ui-sans-serif, system-ui";
      ctx.fillText(rows[0][0], bx + 10, by + 18);
      ctx.font = "11px ui-sans-serif, system-ui";
      for (let r = 1; r < rows.length; r++) {
        const yrow = by + 18 + r * 15;
        ctx.fillStyle = "#9aa3b5";
        ctx.textAlign = "left";
        ctx.fillText(rows[r][0], bx + 10, yrow);
        ctx.fillStyle = "#e6e9f0";
        ctx.textAlign = "right";
        ctx.fillText(rows[r][1], bx + boxW - 10, yrow);
        ctx.textAlign = "left";
      }
    }
  }, [data, t]);

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
    const sp = Math.min(1, v.x1 - v.x0);
    if (v.x1 - v.x0 >= 1) { v.x0 = 0; v.x1 = 1; return; }
    if (v.x0 < 0) { v.x1 = sp; v.x0 = 0; }
    if (v.x1 > 1) { v.x0 = 1 - sp; v.x1 = 1; }
  }
  function clampY(v: View, lo: number, hi: number) {
    const full = hi - lo;
    const sp = Math.min(full, v.y1 - v.y0);
    if (v.y1 - v.y0 >= full) { v.y0 = lo; v.y1 = hi; return; }
    if (v.y0 < lo) { v.y1 = lo + sp; v.y0 = lo; }
    if (v.y1 > hi) { v.y0 = hi - sp; v.y1 = hi; }
  }

  function plotMetrics() {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { rect, plotX: PADL, plotW: rect.width - PADL - PADR, plotH: rect.height - PADB };
  }

  function onWheel(e: React.WheelEvent) {
    if (!data) return;
    e.preventDefault();
    const { rect, plotX, plotW, plotH } = plotMetrics();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const v = viewRef.current;
    const tf0 = v.x0 + (Math.max(0, Math.min(plotW, mx - plotX)) / plotW) * (v.x1 - v.x0);
    const price = v.y0 + (1 - Math.max(0, Math.min(plotH, my)) / plotH) * (v.y1 - v.y0);
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
    if (!data) return;
    const { rect, plotW, plotH } = plotMetrics();
    hoverRef.current = { mx: e.clientX - rect.left, my: e.clientY - rect.top };
    if (dragRef.current) {
      const v = viewRef.current;
      const dtf = ((e.clientX - dragRef.current.x) / plotW) * (v.x1 - v.x0);
      const dp = ((e.clientY - dragRef.current.y) / plotH) * (v.y1 - v.y0);
      v.x0 -= dtf; v.x1 -= dtf;
      v.y0 += dp; v.y1 += dp;
      clampX(v);
      clampY(v, data.heatmap.priceMin, data.heatmap.priceMax);
      dragRef.current = { x: e.clientX, y: e.clientY };
    }
    requestDraw();
  }
  function onPointerUp() {
    dragRef.current = null;
  }
  function onPointerLeave() {
    dragRef.current = null;
    hoverRef.current = null;
    requestDraw();
  }
  function resetView() {
    if (!data) return;
    viewRef.current = { x0: 0, x1: 1, y0: data.heatmap.priceMin, y1: data.heatmap.priceMax };
    requestDraw();
  }

  return (
    <div className="px-6 py-5 h-screen flex flex-col">
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

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={exchange}
          onChange={(e) => setExchange(e.target.value)}
          className="input-base text-sm rounded-lg px-3 py-1.5 cursor-pointer hover:border-border-strong"
        >
          {EXCHANGES.map((e) => (
            <option key={e} value={e}>
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </option>
          ))}
        </select>
        <SearchSelect
          value={symbol}
          options={symbols}
          allLabel={symbol}
          hideAll
          placeholder={t("trades.searchSymbol")}
          onChange={(v) => setSymbol(v)}
        />
        <select
          value={tf}
          onChange={(e) => setTf(e.target.value)}
          className="input-base text-sm rounded-lg px-3 py-1.5 ml-auto cursor-pointer hover:border-border-strong"
        >
          {TFS.map((f) => (
            <option key={f} value={f}>
              {t(`liq.tf.${f}`)}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="card p-10 text-center text-loss">{error}</div>
      ) : (
        <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden border border-border" style={{ background: "#08080d" }}>
          <canvas
            ref={canvasRef}
            className="w-full h-full block touch-none cursor-crosshair"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
          />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-faint bg-black/30">
              {t("common.loading")}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 mt-3 text-xs text-faint shrink-0">
        <span>{t("liq.zoomHint")}</span>
        <span className="ml-auto">{t("liq.disclaimer")}</span>
      </div>
    </div>
  );
}
