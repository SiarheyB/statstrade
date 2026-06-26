"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

type ObHeatmap = {
  priceMin: number;
  priceMax: number;
  bins: number;
  cols: number;
  grid: number[][];
  maxVal: number;
  price: number;
  times: number[];
};
type Candle = { t: number; o: number; h: number; l: number; c: number };
type DeltaSeries = { times: number[]; buy: number[]; sell: number[]; delta: number[]; cvd: number[] };
type Resp = {
  symbol: string;
  exchange: string;
  range: string;
  from: number;
  to: number;
  heatmap: ObHeatmap | null;
  candles: Candle[];
  delta: DeltaSeries | null;
};

const RANGES = ["15m", "1h", "4h", "24h"] as const;
const EXCHANGES = ["binance-futures", "bybit-futures", "okx-futures", "all"] as const;
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

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
function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (z: number) => String(z).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Heatmap лимитных ордеров в стиле ClusterBtc/Bookmap: тёмный фон, «стены»
// рисуются как светлые горизонтальные полосы, яркость = объём лимиток на уровне.
// minT — порог отображения (скрыть мелочь), gamma — кривая яркости.
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
      const row = hm.bins - 1 - b; // высокая цена сверху
      const idx = (row * hm.cols + c) * 4;
      if (lin < minT) {
        img.data[idx + 3] = 0;
        continue;
      }
      const t = Math.pow(lin, gamma);
      const g = 180 + Math.round(60 * t);
      img.data[idx] = g;
      img.data[idx + 1] = g;
      img.data[idx + 2] = Math.min(255, g + 12);
      img.data[idx + 3] = Math.round(235 * t);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export default function OrderflowPage() {
  const { t } = useI18n();
  const [range, setRange] = useState<string>("4h");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [exchange, setExchange] = useState("binance-futures");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Слайдеры фильтрации: порог отображения (%) и яркость (%).
  const [minPct, setMinPct] = useState(2);
  const [brightness, setBrightness] = useState(55);
  const [live, setLive] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deltaRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const hoverRef = useRef<{ mx: number; my: number } | null>(null);

  const gamma = useMemo(() => 1 - (brightness / 100) * 0.8, [brightness]); // 1.0 → 0.2
  const minT = useMemo(() => minPct / 100, [minPct]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orderflow?range=${range}&symbol=${symbol}&exchange=${exchange}`);
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Error");
        setData(null);
        return;
      }
      offRef.current = null;
      setData(d);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [range, symbol, exchange]);

  useEffect(() => {
    load();
  }, [load]);

  // Live-обновление: тихо перезапрашиваем каждые 3с (без спиннера/мигания).
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/orderflow?range=${range}&symbol=${symbol}&exchange=${exchange}`);
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
  }, [live, range, symbol, exchange]);

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

    const plotX = PADL;
    const plotW = W - PADL - PADR;
    const plotH = H - PADB;

    const t0 = data.from;
    const t1 = data.to;
    const xspan = t1 - t0 || 1;
    const sx = (ms: number) => plotX + ((ms - t0) / xspan) * plotW;

    let yMin = hm.priceMin;
    let yMax = hm.priceMax;
    for (const k of candles) {
      if (k.l < yMin) yMin = k.l;
      if (k.h > yMax) yMax = k.h;
    }
    const yspan = yMax - yMin || 1;
    const sy = (p: number) => plotH - ((p - yMin) / yspan) * plotH;

    // Heatmap (offscreen, перестраивается при смене данных/слайдеров).
    const key = `${data.from}:${data.to}:${minT}:${gamma}`;
    if (!offRef.current || offRef.current.key !== key) {
      offRef.current = { key, canvas: buildOffscreen(hm, minT, gamma) };
    }
    const hmX0 = sx(hm.times[0] ?? t0);
    const hmX1 = sx(hm.times[hm.cols - 1] ?? t1);
    const hmYTop = sy(hm.priceMax);
    const hmYBot = sy(hm.priceMin);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      offRef.current.canvas,
      0, 0, hm.cols, hm.bins,
      hmX0, hmYTop, Math.max(1, hmX1 - hmX0), Math.max(1, hmYBot - hmYTop),
    );

    // Ценовая сетка + подписи (справа).
    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.textAlign = "left";
    for (let i = 0; i <= 6; i++) {
      const price = yMin + (i / 6) * yspan;
      const y = plotH - (i / 6) * plotH;
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(plotX, y);
      ctx.lineTo(plotX + plotW, y);
      ctx.stroke();
      ctx.fillStyle = "#8a93a6";
      ctx.fillText(fmtP(price), plotX + plotW + 5, Math.min(plotH - 2, Math.max(9, y + 3)));
    }

    // Подписи времени (снизу).
    ctx.textAlign = "center";
    ctx.fillStyle = "#6b7384";
    for (let i = 0; i <= 6; i++) {
      const ms = t0 + (i / 6) * xspan;
      ctx.fillText(fmtTime(ms), sx(ms), H - 6);
    }
    ctx.textAlign = "left";

    // Свечи поверх.
    if (candles.length > 1) {
      const stepMs = candles[1].t - candles[0].t;
      const cw = Math.max(1, (stepMs / xspan) * plotW * 0.7);
      for (const k of candles) {
        const x = sx(k.t + stepMs / 2);
        if (x < plotX - 2 || x > plotX + plotW + 2) continue;
        const up = k.c >= k.o;
        ctx.strokeStyle = up ? "#16c784" : "#ea3943";
        ctx.fillStyle = up ? "#16c784" : "#ea3943";
        ctx.beginPath();
        ctx.moveTo(x, sy(k.h));
        ctx.lineTo(x, sy(k.l));
        ctx.stroke();
        const yo = sy(k.o);
        const yc = sy(k.c);
        ctx.fillRect(x - cw / 2, Math.min(yo, yc), cw, Math.max(1, Math.abs(yc - yo)));
      }
    }

    // Линия текущей цены.
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

    // Кросхейр + тултип.
    const hov = hoverRef.current;
    if (hov && hov.mx >= plotX && hov.mx <= plotX + plotW && hov.my <= plotH) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hov.mx, 0);
      ctx.lineTo(hov.mx, plotH);
      ctx.moveTo(plotX, hov.my);
      ctx.lineTo(plotX + plotW, hov.my);
      ctx.stroke();
      ctx.setLineDash([]);

      const ms = t0 + ((hov.mx - plotX) / plotW) * xspan;
      const priceH = yMin + (1 - hov.my / plotH) * yspan;
      // Ближайшая колонка по времени и бин по цене.
      let colIdx = 0;
      let bestDt = Infinity;
      for (let c = 0; c < hm.cols; c++) {
        const dt = Math.abs((hm.times[c] ?? t0) - ms);
        if (dt < bestDt) { bestDt = dt; colIdx = c; }
      }
      const binIdx = Math.max(0, Math.min(hm.bins - 1, Math.floor(((priceH - hm.priceMin) / (hm.priceMax - hm.priceMin || 1)) * hm.bins)));
      const vol = hm.grid[colIdx]?.[binIdx] ?? 0;

      ctx.fillStyle = "#e6b800";
      ctx.fillRect(plotX + plotW, hov.my - 7, PADR, 14);
      ctx.fillStyle = "#08080d";
      ctx.fillText(fmtP(priceH), plotX + plotW + 5, hov.my + 3);

      const lines = [
        fmtTime(ms),
        `${t("of.tipPrice")}: ${fmtP(priceH)}`,
        `${t("of.tipVol")}: ${fmtVal(vol)} (${fmtVal(vol * priceH)} $)`,
      ];
      const boxW = 184;
      const boxH = 12 + lines.length * 15;
      let bx = hov.mx + 14;
      let by = hov.my + 14;
      if (bx + boxW > plotX + plotW) bx = hov.mx - boxW - 14;
      if (by + boxH > plotH) by = hov.my - boxH - 14;
      ctx.fillStyle = "rgba(16,18,26,0.95)";
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeRect(bx, by, boxW, boxH);
      ctx.fillStyle = "#cdd3df";
      lines.forEach((ln, i) => ctx.fillText(ln, bx + 8, by + 16 + i * 15));
    }
  }, [data, minT, gamma, t]);

  // Нижняя панель: дельта (гистограмма) + кумулятивная дельта (линия).
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
    const plotX = 8;
    const plotW = W - plotX - 64;
    if (!d || d.delta.length === 0) {
      ctx.fillStyle = "#6b7384";
      ctx.font = "11px ui-sans-serif, system-ui";
      ctx.fillText(t("of.noDelta"), plotX, H / 2);
      return;
    }
    const t0 = data.from;
    const t1 = data.to;
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
    // Нулевая линия.
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(plotX, mid);
    ctx.lineTo(plotX + plotW, mid);
    ctx.stroke();

    // CVD (кумулятивная дельта) — линия в своём масштабе.
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

  useEffect(() => {
    draw();
    drawDelta();
    const onResize = () => { draw(); drawDelta(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw, drawDelta]);

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    hoverRef.current = { mx: e.clientX - rect.left, my: e.clientY - rect.top };
    draw();
  }
  function onLeave() {
    hoverRef.current = null;
    draw();
  }

  const hm = data?.heatmap ?? null;
  const SELECT = "input-base text-sm py-1.5 cursor-pointer";

  return (
    <div className="px-6 py-5 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Layers size={20} className="text-accent" />
            {t("of.title")}
          </h1>
          <p className="text-sm text-muted">{t("of.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={SELECT} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={SELECT} value={exchange} onChange={(e) => setExchange(e.target.value)}>
            {EXCHANGES.map((x) => <option key={x} value={x}>{x === "all" ? t("of.allExchanges") : x}</option>)}
          </select>
          <div className="flex gap-1 text-xs">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2.5 py-1.5 rounded-md transition ${
                  range === r ? "bg-accent/15 text-accent" : "text-muted hover:text-fg"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            onClick={() => setLive((v) => !v)}
            className={`inline-flex items-center gap-1.5 input-base py-1.5 text-sm transition ${
              live ? "text-profit border-profit/40" : "text-muted hover:border-border-strong"
            }`}
            title={t("of.live")}
          >
            <span className={`h-2 w-2 rounded-full ${live ? "bg-profit animate-pulse" : "bg-faint"}`} />
            LIVE
          </button>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 input-base py-1.5 hover:border-border-strong transition"
            title={t("dash.refresh")}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Слайдеры фильтрации */}
      <div className="flex flex-wrap items-center gap-6 mb-3 text-xs text-muted">
        <label className="flex items-center gap-2">
          <span className="w-28">{t("of.filterThreshold")}: {minPct}%</span>
          <input type="range" min={0} max={40} value={minPct} onChange={(e) => setMinPct(Number(e.target.value))} className="accent-accent w-40" />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-28">{t("of.filterBrightness")}: {brightness}%</span>
          <input type="range" min={0} max={100} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="accent-accent w-40" />
        </label>
      </div>

      {error && <div className="card p-4 text-sm text-loss border-loss/30 mb-5">{error}</div>}

      {loading && !data ? (
        <div className="text-sm text-faint">{t("common.loading")}</div>
      ) : !hm ? (
        <div className="card p-10 text-center text-muted">{t("of.empty")}</div>
      ) : (
        <>
          <div className="card p-2" style={{ background: "#0a0b10" }}>
            <canvas
              ref={canvasRef}
              className="w-full"
              style={{ height: 540 }}
              onMouseMove={onMove}
              onMouseLeave={onLeave}
            />
            <div className="mt-1 border-t border-border/40 pt-1">
              <canvas ref={deltaRef} className="w-full" style={{ height: 120 }} />
            </div>
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
          </div>
        </>
      )}
    </div>
  );
}
