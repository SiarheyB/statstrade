"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers, RefreshCw, HelpCircle } from "lucide-react";
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

const RANGES = ["15m", "1h", "4h", "24h"] as const;
const FALLBACK_EXCHANGES = ["binance-futures", "binance-spot"];
const FALLBACK_SYMBOLS = ["BTCUSDT", "ETHUSDT"];

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
// Дата + время для подсказки свечи.
function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (z: number) => String(z).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Базовый актив пары (BTCUSDT → BTC) для подписи объёма лимиток.
function baseAsset(symbol: string): string {
  return symbol.replace(/(USDT|USDC|BUSD|USD|FDUSD)$/i, "") || symbol;
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
  // Дефолты детерминированы для SSR; сохранённые настройки подгружаются в эффекте
  // после монтирования (иначе ломается гидрация).
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
  const [clusters, setClusters] = useState(true);
  // Показывать ли heatmap «истории лимитных ордеров» поверх свечей.
  const [showLiq, setShowLiq] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [metaSymbols, setMetaSymbols] = useState<string[]>(FALLBACK_SYMBOLS);
  const [metaExchanges, setMetaExchanges] = useState<string[]>(FALLBACK_EXCHANGES);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deltaRef = useRef<HTMLCanvasElement>(null);
  const baRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const hoverRef = useRef<{ mx: number; my: number } | null>(null);
  // Видимая область (zoom/pan). null = автодиапазон по данным.
  const viewRef = useRef<{ t0: number; t1: number; y0: number; y1: number } | null>(null);
  const dragRef = useRef<{ mx: number; my: number; view: { t0: number; t1: number; y0: number; y1: number } } | null>(null);
  const layoutRef = useRef<{ plotX: number; plotW: number; plotH: number } | null>(null);
  // Полные границы данных + шаг свечи — для ограничения зума.
  const boundsRef = useRef<{ t0: number; t1: number; y0: number; y1: number; step: number } | null>(null);

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
      viewRef.current = null; // сброс zoom/pan при смене диапазона/символа/биржи
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

  // Подгрузка сохранённых настроек после монтирования (один раз).
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("orderflow.settings") || "{}");
      if (typeof s.range === "string") setRange(s.range);
      if (typeof s.symbol === "string") setSymbol(s.symbol);
      if (typeof s.exchange === "string") setExchange(s.exchange);
      if (typeof s.minPct === "number") setMinPct(s.minPct);
      if (typeof s.brightness === "number") setBrightness(s.brightness);
      if (typeof s.live === "boolean") setLive(s.live);
      if (typeof s.clusters === "boolean") setClusters(s.clusters);
      if (typeof s.showLiq === "boolean") setShowLiq(s.showLiq);
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  // Сохраняем настройки между сессиями (после первичной подгрузки).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        "orderflow.settings",
        JSON.stringify({ range, symbol, exchange, minPct, brightness, live, clusters, showLiq }),
      );
    } catch {
      // ignore
    }
  }, [hydrated, range, symbol, exchange, minPct, brightness, live, clusters, showLiq]);

  // Доступные символы/биржи из реально собранных данных.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/orderflow/meta");
        if (!res.ok) return;
        const m = await res.json();
        if (Array.isArray(m.symbols) && m.symbols.length) setMetaSymbols(m.symbols);
        if (Array.isArray(m.exchanges) && m.exchanges.length) setMetaExchanges(m.exchanges);
      } catch {
        // оставляем дефолты
      }
    })();
  }, []);

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

    const PP = 76; // ширина левой панели профиля объёма
    const plotX = PADL + PP;
    const plotW = W - plotX - PADR;
    const plotH = H - PADB;
    layoutRef.current = { plotX, plotW, plotH };

    // Полный диапазон по данным.
    const fullT0 = data.from;
    const fullT1 = data.to;
    let fYMin = hm.priceMin;
    let fYMax = hm.priceMax;
    for (const k of candles) {
      if (k.l < fYMin) fYMin = k.l;
      if (k.h > fYMax) fYMax = k.h;
    }
    // Полные границы + шаг свечи — для ограничения зума в onWheel.
    const candleStep = candles.length > 1 ? candles[1].t - candles[0].t : (fullT1 - fullT0) / 40;
    boundsRef.current = { t0: fullT0, t1: fullT1, y0: fYMin, y1: fYMax, step: candleStep };
    // Видимая область: текущий view либо полный диапазон.
    if (!viewRef.current) viewRef.current = { t0: fullT0, t1: fullT1, y0: fYMin, y1: fYMax };
    const v = viewRef.current;
    const t0 = v.t0;
    const t1 = v.t1;
    const yMin = v.y0;
    const yMax = v.y1;
    const xspan = t1 - t0 || 1;
    const sx = (ms: number) => plotX + ((ms - t0) / xspan) * plotW;
    const yspan = yMax - yMin || 1;
    const sy = (p: number) => plotH - ((p - yMin) / yspan) * plotH;

    // Heatmap (offscreen, перестраивается при смене данных/слайдеров).
    // Рисуем только если включена «История лимитных ордеров».
    if (showLiq) {
      const key = `${data.from}:${data.to}:${minT}:${gamma}`;
      if (!offRef.current || offRef.current.key !== key) {
        offRef.current = { key, canvas: buildOffscreen(hm, minT, gamma) };
      }
      const hmX0 = sx(hm.times[0] ?? t0);
      const hmX1 = sx(hm.times[hm.cols - 1] ?? t1);
      const hmYTop = sy(hm.priceMax);
      const hmYBot = sy(hm.priceMin);
      // Без сглаживания — «стены» чёткие (как в ClusterBtc), а не размытые полосы.
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        offRef.current.canvas,
        0, 0, hm.cols, hm.bins,
        hmX0, hmYTop, Math.max(1, hmX1 - hmX0), Math.max(1, hmYBot - hmYTop),
      );
      ctx.imageSmoothingEnabled = true;

      // Подписи объёма на крупных «стенах» лимиток — при достаточном зуме.
      // Помечаем вертикальные локальные максимумы (центр стены), чтобы не
      // дублировать число на каждом бине одной полосы. Текст тёмный — полосы светлые.
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
              // Локальный максимум по цене И по времени → одна подпись на «стену».
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

    // Левая панель: профиль текущей ликвидности (bid зелёный / ask красный).
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
      // Разделитель панели.
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(plotX - 1, 0);
      ctx.lineTo(plotX - 1, plotH);
      ctx.stroke();
    }

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

    // Footprint-кластеры (как в ClusterBtc): у каждой свечи СПРАВА от её оси —
    // горизонтальная гистограмма объёмов по ценовым уровням. Длина бара = объём
    // (нормирован по самому объёмному уровню этой свечи, чтобы профиль всегда был
    // читаем), цвет по дельте уровня (buy≥sell → зелёный, иначе красный).
    const fp = data.footprint;
    const colW = fp ? (fp.interval / xspan) * plotW : 0;
    if (clusters && fp && fp.maxVol > 0 && fp.candles.length) {
      // Ключевой момент детализации: цены футпринта мелкие, а диапазон по экрану
      // большой, поэтому «сырой» уровень = доли пикселя и сливается. Агрегируем
      // уровни в ПИКСЕЛЬНЫЕ строки фиксированной высоты — кластер читаем при любом
      // зуме/масштабе. Высота строки растёт, когда колонка широкая (больше места).
      const rowPx = colW >= 80 ? 12 : colW >= 50 ? 10 : colW >= 32 ? 8 : 6;
      // Бары не должны доходить до следующей свечи: оставляем зазор ≥3× тени
      // перед её телом (тело = 3× тени, рисуется слева от оси следующей свечи).
      const wickW = Math.min(3, Math.max(1, colW * 0.05));
      const maxBarW = Math.max(4, colW - wickW * 3 - wickW * 3 - 2);
      // Числа объёма показываем, когда строка достаточно высокая для текста.
      const showNums = rowPx >= 8;
      const fontPx = Math.min(11, Math.max(7, rowPx - 1));
      if (showNums) {
        ctx.font = `${fontPx}px ui-sans-serif, system-ui`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
      }
      for (const fc of fp.candles) {
        const x0 = sx(fc.t + fp.interval / 2); // ось свечи
        if (x0 < plotX - colW || x0 > plotX + plotW + colW) continue;
        // Складываем уровни в строки по пиксельной координате.
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
          ctx.fillStyle = r.buy >= r.sell ? "rgba(15,136,90,0.6)" : "rgba(160,39,46,0.6)"; // на 3 тона темнее, более прозрачные
          ctx.fillRect(x0 + 1, y, len, Math.max(1, rowPx - 0.6));
          // Число объёма — поверх самого бара (если влезает по длине).
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

    // Свечи поверх. При включённых кластерах тело свечи рисуем СЛЕВА от её оси,
    // а гистограмму кластеров — справа (как в ClusterBtc), чтобы они не наезжали.
    if (candles.length > 1) {
      const stepMs = candles[1].t - candles[0].t;
      // Тень (фитиль) — тонкая линия, тело — ровно в 3 раза шире тени.
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
        ctx.strokeStyle = up ? "#13af74" : "#ce323b"; // на 1 тон темнее
        ctx.fillStyle = up ? "#13af74" : "#ce323b";
        ctx.beginPath();
        ctx.moveTo(x, sy(k.h));
        ctx.lineTo(x, sy(k.l));
        ctx.stroke();
        const yo = sy(k.o);
        const yc = sy(k.c);
        const bodyX = clusters ? x - cw - 1 : x - cw / 2; // тело слева от оси при кластерах
        ctx.fillRect(bodyX, Math.min(yo, yc), cw, Math.max(1, Math.abs(yc - yo)));
      }
      ctx.lineWidth = 1;
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

      // Наведение на «стену» лимитных ордеров → подсказка про лимитный ордер и
      // объём монет на уровне. Иначе (пустое место / свеча) — только дата+время.
      const stepMs = candles.length > 1 ? candles[1].t - candles[0].t : 0;
      const cndl = stepMs ? candles.find((k) => ms >= k.t && ms < k.t + stepMs) : undefined;
      const base = baseAsset(data.symbol);
      // Стену показываем только если она реально отрисована — т.е. выше порога
      // «Мин. размер» (minT). Иначе на «пустом» месте всплывала ложная подсказка.
      const hasWall = showLiq && hm.maxVal > 0 && vol / hm.maxVal >= minT;
      const lines = hasWall
        ? [
            t("of.tipLimitOrder"),
            `${fmtP(priceH)} · ${fmtVal(vol)} ${base}`,
          ]
        : [fmtDateTime(cndl ? cndl.t : ms)];
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
  }, [data, minT, gamma, clusters, showLiq, t]);

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
    const plotX = 8 + 76; // выравнивание с основным графиком (PADL + панель профиля)
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

  // B/A панель: доля bid во времени (полная глубина и в пределах ±1%). 0.5 = баланс.
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
    const sy = (v: number) => H - 4 - v * (H - 8); // 0..1

    // Зона >0.5 (бид-перевес) зелёная, <0.5 (аск) красная — заливка фона.
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
        if (data.ba!.full[i] === 0.5 && data.ba!.near[i] === 0.5) continue; // пропуск пустых корзин
        const x = sx(ba.times[i]);
        const y = sy(vals[i]);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
    };
    line(ba.full, "#5b8def"); // полная глубина
    line(ba.near, "#e6b800"); // ±1%

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

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    hoverRef.current = { mx, my };
    const drag = dragRef.current;
    const lay = layoutRef.current;
    if (drag && lay) {
      const dt = ((mx - drag.mx) / lay.plotW) * (drag.view.t1 - drag.view.t0);
      const dp = ((my - drag.my) / lay.plotH) * (drag.view.y1 - drag.view.y0);
      viewRef.current = {
        t0: drag.view.t0 - dt,
        t1: drag.view.t1 - dt,
        y0: drag.view.y0 + dp,
        y1: drag.view.y1 + dp,
      };
      redrawAll();
    } else {
      draw();
    }
  }
  function onLeave() {
    hoverRef.current = null;
    dragRef.current = null;
    draw();
  }
  function onDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (viewRef.current) {
      dragRef.current = { mx: e.clientX - rect.left, my: e.clientY - rect.top, view: { ...viewRef.current } };
    }
  }
  function onUp() {
    dragRef.current = null;
  }
  function onDouble() {
    viewRef.current = null; // сброс к автодиапазону
    redrawAll();
  }

  // Колесо/свайп: пропорциональный zoom ОБЕИХ осей (время X и цена Y) одним
  // коэффициентом вокруг курсора — как в ClusterBtc. Величину зума берём из
  // доминирующего направления жеста (deltaY у мыши, deltaX/Y у трекпада).
  // Shift+колесо — только по времени (X), точечная подстройка ширины.
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
      // Ограничения зума: не отдалить шире загруженного окна и не приблизить
      // ближе предела. Предел приближения на 30% «дальше» (минимальный размер
      // окна больше в 1.30× — т.е. максимальное увеличение на 30% меньше).
      const ZOOM_IN_LIMIT = 5;
      // Отдаление можно немного больше полного окна — для «воздуха» по краям.
      const ZOOM_OUT_LIMIT = 2;
      const maxTSpan = b ? (b.t1 - b.t0) * ZOOM_OUT_LIMIT : Infinity;
      const minTSpan = b ? b.step * 3 * ZOOM_IN_LIMIT : 0;
      const maxPSpan = b ? (b.y1 - b.y0) * ZOOM_OUT_LIMIT : Infinity;
      const minPSpan = b ? (b.y1 - b.y0) * 0.05 * ZOOM_IN_LIMIT : 0;
      const clamp = (val: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, val));

      // Время (X) — всегда; цена (Y) — кроме Shift (тогда только ширина).
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
          <select className={SELECT} value={symbol} onChange={(e) => setSymbol(e.target.value)} title={t("of.hintSymbol")}>
            {metaSymbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={SELECT} value={exchange} onChange={(e) => setExchange(e.target.value)} title={t("of.hintExchange")}>
            {metaExchanges.map((x) => <option key={x} value={x}>{x}</option>)}
            <option value="all">{t("of.allExchanges")}</option>
          </select>
          <div className="flex gap-1 text-xs" title={t("of.hintTimeframe")}>
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
            onClick={() => setShowLiq((v) => !v)}
            className={`inline-flex items-center gap-1.5 input-base py-1.5 text-sm transition ${
              showLiq ? "text-accent border-accent/40" : "text-muted hover:border-border-strong"
            }`}
          >
            <span className={`h-3 w-3 rounded-sm border ${showLiq ? "bg-accent border-accent" : "border-border-strong"}`} />
            {t("of.showLiq")}
            <span title={t("of.hintShowLiq")} className="inline-flex cursor-help">
              <HelpCircle size={12} className="text-faint shrink-0" />
            </span>
          </button>
          <button
            onClick={() => setClusters((v) => !v)}
            className={`inline-flex items-center gap-1.5 input-base py-1.5 text-sm transition ${
              clusters ? "text-accent border-accent/40" : "text-muted hover:border-border-strong"
            }`}
          >
            {t("of.clusters")}
            <span title={t("of.hintClusters")} className="inline-flex cursor-help">
              <HelpCircle size={12} className="text-faint shrink-0" />
            </span>
          </button>
          <button
            onClick={() => setLive((v) => !v)}
            className={`inline-flex items-center gap-1.5 input-base py-1.5 text-sm transition ${
              live ? "text-profit border-profit/40" : "text-muted hover:border-border-strong"
            }`}
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
          <input type="range" min={0} max={40} value={minPct} onChange={(e) => setMinPct(Number(e.target.value))} className="accent-accent w-40" />
        </label>
        <label className="flex items-center gap-2" title={t("of.hintBrightness")}>
          <span className="w-28 inline-flex items-center gap-1">
            {t("of.filterBrightness")}: {brightness}%
            <HelpCircle size={12} className="text-faint shrink-0" />
          </span>
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
              className="w-full cursor-crosshair"
              style={{ height: 540 }}
              onMouseMove={onMove}
              onMouseLeave={onLeave}
              onMouseDown={onDown}
              onMouseUp={onUp}
              onDoubleClick={onDouble}
            />
            <div className="mt-1 border-t border-border/40 pt-1">
              <canvas ref={deltaRef} className="w-full" style={{ height: 110 }} />
            </div>
            <div className="mt-1 border-t border-border/40 pt-1">
              <canvas ref={baRef} className="w-full" style={{ height: 80 }} />
            </div>
          </div>
          <div className="mt-1 text-[11px] text-faint">{t("of.zoomHint")}</div>

          {/* Лента крупных рыночных ордеров */}
          <div className="card p-3 mt-3">
            <div className="text-xs font-medium text-muted mb-2">{t("of.bigTrades")}</div>
            {(data?.bigTrades?.length ?? 0) === 0 ? (
              <div className="text-xs text-faint">{t("of.noBig")}</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-1 text-xs tabular-nums">
                {data!.bigTrades.slice(0, 24).map((b, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 border-b border-border/30 py-0.5">
                    <span className="text-faint">{fmtTime(b.t)}</span>
                    <span className="text-faint/70 uppercase text-[10px] w-7">{b.exchange.slice(0, 3)}</span>
                    <span className={b.side === "buy" ? "text-profit" : "text-loss"}>
                      {b.side === "buy" ? "▲" : "▼"} {fmtP(b.price)}
                    </span>
                    <span className="text-fg">{b.qty.toFixed(3)}</span>
                    <span className="text-faint">{fmtVal(b.qty * b.price)}$</span>
                  </div>
                ))}
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
