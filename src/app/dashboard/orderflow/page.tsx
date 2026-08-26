"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Layers,
  RefreshCw,
  HelpCircle,
  Filter,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  shiftedMs,
  type TimezoneId,
} from "@/lib/timezone";
import VolumeProfile from "@/components/VolumeProfile";
import type { VolumeProfile as VPData } from "@/components/VolumeProfile";
import { drawVolumeProfileOverlay } from "@/components/VolumeProfileOverlay";
import { profileFromFootprint } from "@/lib/visibleVolumeProfile";
import { drawDivergenceMarkers } from "@/components/DivergenceOverlay";
import { drawAbsorptionMarkers } from "@/components/AbsorptionOverlay";
import { drawDrawings } from "@/components/DrawingOverlay";
import DivergenceHistory from "@/components/DivergenceHistory";
import AbsorptionPanel from "@/components/AbsorptionPanel";
import DrawingToolbar from "@/components/DrawingToolbar";
import DrawingEditor from "@/components/DrawingEditor";
import FullscreenButton from "@/components/FullscreenButton";
import KeepAwakeButton from "@/components/KeepAwakeButton";
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
  drawHistoryStartBoundary,
  fmtPriceLabel as fmtP,
  fmtValLabel as fmtVal,
  fmtTimeHM as fmtTime,
  PADL,
  PADB,
  PRICE_AXIS_W,
} from "@/lib/candlestickChart";
import { useChartInteractions } from "@/lib/useChartInteractions";
import { useFullscreen } from "@/lib/useFullscreen";

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
  bigTrades: BigTrade[];
};

// Кусок истории, догруженный через /api/orderflow/history: свой heatmap и свой
// футпринт на свой отрезок времени. Раньше история приходила только свечами, и
// при скролле влево карта лимиток с кластерами просто обрывалась.
type HistorySegment = { from: number; to: number; heatmap: ObHeatmap | null; footprint: Footprint | null };

const RANGES = ["5m", "15m", "1h", "4h", "12h", "1d", "1w"] as const;
const VISIBLE_CANDLES: Record<string, number> = { "5m": 130, "15m": 120, "1h": 110, "4h": 100, "12h": 95, "1d": 90, "1w": 60 };
const DEFAULT_VISIBLE = 100;
// Верхняя граница памяти для догруженной истории (historyRef). При
// превышении обрезаем самый старый конец — если пользователь доскроллит
// туда снова, история перезапросится тем же механизмом, что и в первый раз.
const MAX_HISTORY_CANDLES = 4000;
// Столько кусков наложений держим в памяти (каждый ~240×110 чисел + растр).
const MAX_HISTORY_SEGMENTS = 8;
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

/**
 * Спиннер загрузки графика: монета биткоина, вращающаяся вокруг вертикальной
 * оси (сжимается по горизонтали и переворачивается), плюс подпись.
 *
 * Рисуем инлайновым SVG, а не картинкой: страница и так тянет тяжёлые данные,
 * а тут нужен лёгкий индикатор, который переживает и тёмную, и светлую тему.
 */
function BtcSpinner({ label }: { label: string }) {
  return (
    <div className="card p-10 flex flex-col items-center justify-center gap-3">
      <div className="btc-spin" aria-hidden>
        <svg width="44" height="44" viewBox="0 0 32 32" role="img">
          <circle cx="16" cy="16" r="15" fill="#f7931a" />
          <path
            d="M21.6 14.2c.25-1.7-1.04-2.6-2.8-3.2l.57-2.3-1.4-.35-.56 2.24c-.37-.09-.75-.18-1.13-.26l.56-2.25-1.4-.35-.57 2.3c-.3-.07-.6-.14-.89-.21v-.01l-1.93-.48-.37 1.5s1.04.24 1.02.25c.57.14.67.51.65.81l-.65 2.62c.04.01.09.02.15.05l-.15-.04-.91 3.67c-.07.17-.24.43-.63.33.01.02-1.02-.25-1.02-.25l-.7 1.6 1.82.46c.34.08.67.17 1 .25l-.58 2.33 1.4.35.57-2.3c.38.1.75.2 1.12.29l-.57 2.29 1.4.35.58-2.33c2.39.45 4.19.27 4.94-1.89.61-1.74-.03-2.75-1.29-3.4.92-.21 1.61-.82 1.79-2.06zm-3.2 4.5c-.43 1.74-3.36.8-4.31.56l.76-3.07c.95.24 4.01.71 3.55 2.51zm.43-4.53c-.39 1.58-2.83.78-3.62.58l.69-2.78c.79.2 3.34.56 2.93 2.2z"
            fill="#fff"
          />
        </svg>
      </div>
      <span className="text-sm text-muted">{label}</span>
      <style>{`
        .btc-spin { animation: btc-flip 1.4s linear infinite; transform-style: preserve-3d; }
        @keyframes btc-flip { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .btc-spin { animation-duration: 4s; }
        }
      `}</style>
    </div>
  );
}

export default function OrderflowPage() {
  const { t, timezone, locale } = useI18n();
  const [range, setRange] = useState<string>("1d");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [exchange, setExchange] = useState("binance-futures");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  // Свечи уже нарисованы, карта лимиток ещё считается (вторая фаза load).
  const [overlaysLoading, setOverlaysLoading] = useState(false);
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
  // Профиль объёма поверх свечей (VPVR). По умолчанию выключен: он затемняет
  // правый край, где стоят самые свежие свечи — это осознанный выбор
  // пользователя, а не то, что должно включаться само.
  const [showVpOverlay, setShowVpOverlay] = useState(false);
  const [imbalanceData, setImbalanceData] = useState<Imbalance | null>(null);
  // Значение нигде не читается — лента скорости рисуется из data напрямую;
  // сеттер оставлен, чтобы не потерять сброс при смене инструмента.
  const [, setSpeedData] = useState<SpeedOfTape | null>(null);
  const [imbalanceLoading, setImbalanceLoading] = useState(false);
  const [imbalanceError, setImbalanceError] = useState<string | null>(null);
  const [absorptionSignals, setAbsorptionSignals] = useState<AbsorptionSignal[]>([]);
  const [absorptionLoading, setAbsorptionLoading] = useState(false);
  const [absorptionError, setAbsorptionError] = useState<string | null>(null);
  const [showAbsorption, setShowAbsorption] = useState(true);
  const [drawings, setDrawings] = useState<DrawingRow[]>([]);
  const [, setDrawingsLoading] = useState(false);
  const [, setDrawingsError] = useState<string | null>(null);
  const [showDrawings, setShowDrawings] = useState(true);
  const [activeTool, setActiveTool] = useState<DrawingToolType | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<DrawingPoint[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [showDrawingEditor, setShowDrawingEditor] = useState(false);
  const [magnet, setMagnet] = useState(true);
  const [drawingsLocked, setDrawingsLocked] = useState(false);
  const [canUndoMove, setCanUndoMove] = useState(false);
  const lastMovedDrawingRef = useRef<{ id: string; points: DrawingPoint[] } | null>(null);

  // Разворот карточки с графиком (свечи + дельта) на весь экран.
  const { ref: fsRef, active: fsActive, toggle: fsToggle } = useFullscreen<HTMLDivElement>();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deltaRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  // Кэш fYMin/fYMax/candleStep — иначе draw() проходил бы весь массив свечей
  // (до MAX_HISTORY_CANDLES) на каждый вызов, включая чисто hover-редрои.
  const rangeCacheRef = useRef<{
    // priceMin/priceMax = null, пока карта лимиток ещё не пришла: шкалу в этот
    // момент задают одни свечи.
    candles: Candle[]; priceMin: number | null; priceMax: number | null;
    // segments = historyVersion: догрузка куска расширяет диапазон цен, поэтому
    // кэш границ должен по нему инвалидироваться.
    segments: number;
    fYMin: number; fYMax: number; candleStep: number;
  } | null>(null);
  // Кэш агрегации footprint по рядам (buy/sell на бакет цены) — раньше
  // пересчитывался Map'ом на каждый draw(), включая чистый hover без смены
  // вида/данных. Инвалидируется при смене fp, масштаба строк или видимого
  // диапазона цены/высоты.
  const footprintRowsCacheRef = useRef<{
    fp: unknown; rowPx: number; yMin: number; yMax: number; plotH: number;
    byCandle: Map<number, { rows: Map<number, { buy: number; sell: number }>; cMax: number }>;
  } | null>(null);

  // Дозагрузка истории свечей "влево" (см. LAZY_HISTORY_PLAN.md). historyRef —
  // старые свечи, догруженные через /api/orderflow/history, всегда старше
  // data.candles[0].t. hasMoreHistoryRef=false — реально упёрлись в край
  // данных в БД (CANDLE_RETENTION_DAYS коллектора).
  const historyRef = useRef<Candle[]>([]);
  // Наложения (heatmap/футпринт) догруженных кусков — по одному на запрос.
  const historySegmentsRef = useRef<HistorySegment[]>([]);
  // Готовые растры heatmap сегментов. sig = настройки яркости/порога: при их
  // смене растры недействительны, проще собрать заново, чем инвалидировать.
  const segOffscreenRef = useRef<{ sig: string; map: Map<number, HTMLCanvasElement> }>({ sig: "", map: new Map() });
  const hasMoreHistoryRef = useRef(true);
  const loadingHistoryRef = useRef(false);
  // Курсор "до какой точки уже точно всё запрошено" — отдельно от historyRef,
  // потому что historyRef обрезается по MAX_HISTORY_CANDLES (память клиента),
  // а курсор для следующего "before" должен идти строго по тому, что реально
  // уже приходило с сервера, иначе после обрезки следующий запрос повторно
  // просит только что обрезанный диапазон — и подгрузка зацикливается,
  // никогда не продвигаясь дальше вглубь истории.
  const earliestFetchedRef = useRef<number | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Футпринт живого окна + куски истории. Идентичность объекта должна меняться
  // только когда реально пришли новые данные: ниже кэш строк футпринта
  // сравнивает fp по ссылке (fpCache.fp === fp).
  const mergedFootprint = useMemo<Footprint | null>(() => {
    const live = data?.footprint ?? null;
    // Как и на форексе: сегменты истории лежат в ref, чтобы их догрузка не
    // перерисовывала график целиком (см. historyVersion).
    // eslint-disable-next-line react-hooks/refs -- history is intentionally out of state
    const segs = historySegmentsRef.current.filter((sg) => sg.footprint && sg.footprint.candles.length);
    if (!segs.length) return live;
    const byT = new Map<number, { t: number; levels: FootprintLevel[] }>();
    for (const sg of segs) for (const c of sg.footprint!.candles) byT.set(c.t, c);
    // Живое окно кладём последним — свежая версия свечи важнее исторической.
    if (live) for (const c of live.candles) byT.set(c.t, c);
    let maxVol = live?.maxVol ?? 0;
    for (const sg of segs) if (sg.footprint!.maxVol > maxVol) maxVol = sg.footprint!.maxVol;
    return {
      interval: live?.interval ?? segs[segs.length - 1].footprint!.interval,
      maxVol,
      candles: [...byT.values()].sort((a, b) => a.t - b.t),
    };
    // historyVersion — сигнал "сегменты изменились" (сами они лежат в ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, historyVersion]);

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

  // Запоминаем геометрию рисунка ДО перетаскивания/ресайза — позволяет
  // "отменить последнее перемещение" одной кнопкой, если рисунок случайно
  // задели курсором и он сдвинулся.
  const handleDrawingMoved = useCallback((id: string, previousPoints: DrawingPoint[]) => {
    lastMovedDrawingRef.current = { id, points: previousPoints };
    setCanUndoMove(true);
  }, []);

  const handleUndoMove = useCallback(() => {
    const last = lastMovedDrawingRef.current;
    if (!last) return;
    lastMovedDrawingRef.current = null;
    setCanUndoMove(false);
    void updateDrawing(last.id, last.points);
  }, [updateDrawing]);

  const deleteDrawingById = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/orderflow/drawings?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setDrawings(prev => prev.filter(dd => dd.id !== id));
        setSelectedDrawingId(null);
        setShowDrawingEditor(false);
        if (lastMovedDrawingRef.current?.id === id) {
          lastMovedDrawingRef.current = null;
          setCanUndoMove(false);
        }
      }
    } catch (err) {
      console.error("Failed to delete drawing", err);
    }
  }, []);

  const handleDeleteSelectedDrawing = useCallback(() => {
    if (!selectedDrawingId) return;
    void deleteDrawingById(selectedDrawingId);
  }, [selectedDrawingId, deleteDrawingById]);

  // Кэш смёрженного массива свечей — без него getMergedCandles() пересоздавал
  // бы новый массив (spread до MAX_HISTORY_CANDLES элементов) на каждый вызов,
  // включая вызовы из onMove на каждый mousemove (чистый hover, без смены
  // данных). Инвалидируется только при реальном изменении data/historyVersion.
  const mergedCandlesCacheRef = useRef<{ data: Resp | null; historyVersion: number; candles: Candle[] } | null>(null);
  const getMergedCandles = useCallback((): Candle[] => {
    const cache = mergedCandlesCacheRef.current;
    if (cache && cache.data === data && cache.historyVersion === historyVersion) {
      return cache.candles;
    }
    const tail = data?.candles ?? [];
    const merged = historyRef.current.length ? [...historyRef.current, ...tail] : tail;
    mergedCandlesCacheRef.current = { data, historyVersion, candles: merged };
    return merged;
  }, [data, historyVersion]);

  const loadMoreHistory = useCallback(async () => {
    if (loadingHistoryRef.current || !hasMoreHistoryRef.current || !data) return;
    const before = earliestFetchedRef.current ?? (historyRef.current.length ? historyRef.current[0].t : data.from);
    loadingHistoryRef.current = true;
    setLoadingHistory(true);
    try {
      // Фаза 1 — только свечи (overlays=0). Наложения для этого же отрезка
      // придут вторым запросом: при скролле влево, как и при первой загрузке,
      // график должен появляться сразу, а карта — дорисовываться поверх.
      const res = await fetch(
        `/api/orderflow/history?symbol=${symbol}&exchange=${exchange}&range=${range}&before=${before}&limit=500&overlays=0`,
      );
      if (!res.ok) {
        hasMoreHistoryRef.current = false;
        setHistoryVersion((v) => v + 1); // перерисовать — показать "начало истории"
        return;
      }
      const d = (await res.json()) as { candles: Candle[]; hasMore: boolean };
      if (!d.candles?.length) {
        hasMoreHistoryRef.current = false;
        setHistoryVersion((v) => v + 1); // перерисовать — показать "начало истории"
        return;
      }
      // Курсор — по факту ответа сервера, не зависит от обрезки буфера ниже.
      earliestFetchedRef.current = d.candles[0].t;
      hasMoreHistoryRef.current = d.hasMore;
      let merged = [...d.candles, ...historyRef.current];
      if (merged.length > MAX_HISTORY_CANDLES) {
        merged = merged.slice(merged.length - MAX_HISTORY_CANDLES);
      }
      historyRef.current = merged;
      setHistoryVersion((v) => v + 1);

      // Фаза 2 — наложения на тот же отрезок. Границы сервер выравнивает по
      // сетке уровня агрегатов, поэтому повторный проход по этому же куску
      // истории отдаётся из кэша, а не считается заново.
      const segFrom = d.candles[0].t;
      const segRes = await fetch(
        `/api/orderflow/segment?symbol=${symbol}&exchange=${exchange}&range=${range}&from=${segFrom}&to=${before}`,
      );
      if (!segRes.ok) return; // свечи уже видны — прокрутка осталась рабочей
      const seg = (await segRes.json()) as { heatmap?: ObHeatmap | null; footprint?: Footprint | null };
      if (seg.heatmap || seg.footprint) {
        const segment: HistorySegment = {
          from: segFrom,
          to: before,
          heatmap: seg.heatmap ?? null,
          footprint: seg.footprint ?? null,
        };
        const segs = [...historySegmentsRef.current, segment].sort((a, b) => a.from - b.from);
        // Тот же принцип, что и с MAX_HISTORY_CANDLES: держим память конечной,
        // выбрасывая самые старые куски (при возврате туда они перезапросятся).
        historySegmentsRef.current = segs.length > MAX_HISTORY_SEGMENTS
          ? segs.slice(segs.length - MAX_HISTORY_SEGMENTS)
          : segs;
        setHistoryVersion((v) => v + 1);
      }
    } catch {
      // тихая сетевая ошибка — следующий триггер (pan/zoom) попробует снова,
      // hasMoreHistoryRef не трогаем (не факт, что история кончилась)
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
    locked: drawingsLocked,
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
    onDrawingMoved: handleDrawingMoved,
    onDeleteSelected: handleDeleteSelectedDrawing,
  });
  // Загрузка в две фазы: сначала свечи, потом наложения.
  //
  // Свечи читаются из ObCandle по первичному ключу — это десятки миллисекунд,
  // и график с настоящими осями появляется сразу. Карта лимиток за то же окно
  // (до года данных) считается заметно дольше, и раньше страница ждала её,
  // чтобы показать хоть что-нибудь. Теперь она ложится поверх уже готового
  // графика, а `overlaysLoading` рисует на её слое индикатор загрузки.
  //
  // Фазы идут ПОСЛЕДОВАТЕЛЬНО, а не параллельно: тяжёлая агрегация иначе
  // конкурирует со свечами за пул соединений Prisma и за ядра сервера, и
  // свечи приходят почти одновременно с ней — то есть весь смысл теряется.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = `range=${range}&symbol=${symbol}&exchange=${exchange}`;
      // Фаза 1 — свечи.
      const res = await fetch(`/api/orderflow/candles?${q}`);
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Error");
        setData(null);
        return;
      }
      offRef.current = null;
      setData({ ...d, heatmap: null, delta: null, footprint: null, bigTrades: [] });
      setLoading(false);

      // Фаза 2 — наложения на ту же границу окна, что у свечей.
      setOverlaysLoading(true);
      const res2 = await fetch(`/api/orderflow?${q}&tz=${timezone}&candles=0&to=${d.to}`);
      if (!res2.ok) {
        // Свечи уже нарисованы — страница остаётся рабочей, сообщаем только про
        // наложения.
        const err = await res2.json().catch(() => ({}));
        console.warn("[orderflow] overlays failed:", err?.error);
        return;
      }
      const d2 = await res2.json();
      setData((prev) => (prev ? { ...prev, ...d2, candles: prev.candles } : prev));
    } catch (e) {
      setError("Network error");
      console.error("[orderflow] load error:", e);
    } finally {
      setLoading(false);
      setOverlaysLoading(false);
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
      if (typeof s.showVpOverlay === "boolean") setShowVpOverlay(s.showVpOverlay);
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
        JSON.stringify({ range, symbol, exchange, minPct, brightness, live, clusters, showLiq, showDivergence, showVpOverlay, showAbsorption, showDrawings }),
      );
    } catch {
      // ignore
    }
  }, [hydrated, range, symbol, exchange, minPct, brightness, live, clusters, showLiq, showVpOverlay, showAbsorption, showDrawings]);

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

  // background=true — фоновый live-опрос (см. интервал ниже): не дёргаем
  // индикатор loading/skeleton, иначе карточка "мигает"/"прыгает" каждые
  // 15с даже когда данные почти не изменились. loading выставляем только
  // на самую первую загрузку (или явный ручной вызов).
  const loadVolumeProfile = useCallback(async (background = false) => {
    if (!background) setVpLoading(true);
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

  const loadDivergence = useCallback(async (background = false) => {
    if (!background) setDivLoading(true);
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

  const loadImbalance = useCallback(async (background = false) => {
    if (!background) setImbalanceLoading(true);
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

  const loadAbsorption = useCallback(async (background = false) => {
    if (!background) setAbsorptionLoading(true);
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

  // LIVE идёт двумя разными темпами, потому что данные живут по-разному.
  //
  // Цена и текущая свеча меняются каждую секунду — их тянем часто, и это
  // дёшево (чтение ObCandle по первичному ключу).
  //
  // Карта лимиток за окно шириной до года за 5 секунд не меняется вообще:
  // прибавляется один минутный бакет из сотен тысяч. Раньше её пересчитывали
  // на каждом тике вместе со свечами — это и была основная нагрузка на сервер
  // от одной открытой вкладки. Теперь наложения обновляются раз в минуту, ровно
  // с тем шагом, с каким сервер выравнивает границу окна: чаще просто нечего
  // показывать, тот же ответ вернётся из кэша.
  const LIVE_CANDLES_MS = 5000;
  const LIVE_OVERLAYS_MS = 60_000;

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const q = `range=${range}&symbol=${symbol}&exchange=${exchange}`;

    const tickCandles = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/orderflow/candles?${q}`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        offRef.current = null;
        // Наложения не трогаем — они живут своим циклом.
        setData((prev) => (prev ? { ...prev, candles: d.candles, to: d.to } : d));
      } catch {
        // тихо
      }
    };

    const tickOverlays = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/orderflow?${q}&tz=${timezone}&candles=0`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        setData((prev) => (prev ? { ...prev, ...d, candles: prev.candles, to: prev.to } : prev));
      } catch {
        // тихо
      }
    };

    const ivC = setInterval(tickCandles, LIVE_CANDLES_MS);
    const ivO = setInterval(tickOverlays, LIVE_OVERLAYS_MS);
    return () => {
      cancelled = true;
      clearInterval(ivC);
      clearInterval(ivO);
    };
  }, [live, range, symbol, exchange, timezone]);

  // Второстепенные индикаторы (Volume Profile, Divergence, Imbalance,
  // Absorption) раньше грузились только один раз при смене symbol/exchange/
  // range и не обновлялись, даже когда включён LIVE — только основной
  // график свечей/карты ордеров жил в реальном времени. Реже основного (15с
  // вместо 3с): это более тяжёлые SQL-агрегации (детекция паттернов), нет
  // смысла гонять их так же часто, как обновление цены.
  useEffect(() => {
    if (!live) return;
    const iv = setInterval(() => {
      if (document.hidden) return;
      loadVolumeProfile(true);
      loadDivergence(true);
      loadImbalance(true);
      loadAbsorption(true);
    }, 15000);
    return () => clearInterval(iv);
  }, [live, loadVolumeProfile, loadDivergence, loadImbalance, loadAbsorption]);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    // Карта лимиток приходит второй фазой загрузки, поэтому её может ещё не
    // быть — свечи рисуем сразу, а heatmap ложится поверх, когда доедет.
    // Раньше здесь стоял ранний возврат по !data.heatmap, и график молчал всё
    // время, пока считалась тяжёлая агрегация.
    if (!cv || !data) return;
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
    let fYMin: number, fYMax: number, candleStep: number;
    const rc = rangeCacheRef.current;
    if (rc && rc.candles === candles && rc.priceMin === (hm?.priceMin ?? null) && rc.priceMax === (hm?.priceMax ?? null)
        && rc.segments === historyVersion) {
      fYMin = rc.fYMin;
      fYMax = rc.fYMax;
      candleStep = rc.candleStep;
    } else {
      // Без карты шкалу цен задают сами свечи.
      fYMin = hm ? hm.priceMin : Infinity;
      fYMax = hm ? hm.priceMax : -Infinity;
      for (const k of candles) {
        if (k.l < fYMin) fYMin = k.l;
        if (k.h > fYMax) fYMax = k.h;
      }
      // Границы по цене раньше считались только по ЖИВОМУ heatmap, поэтому
      // стены из догруженных кусков могли оказаться выше/ниже видимой области
      // и выглядеть как «истории нет».
      for (const seg of historySegmentsRef.current) {
        if (!seg.heatmap) continue;
        if (seg.heatmap.priceMin < fYMin) fYMin = seg.heatmap.priceMin;
        if (seg.heatmap.priceMax > fYMax) fYMax = seg.heatmap.priceMax;
      }
      if (!Number.isFinite(fYMin) || !Number.isFinite(fYMax)) {
        // Ни карты, ни свечей — рисовать нечего.
        return;
      }
      candleStep = candles.length > 1 ? candles[1].t - candles[0].t : (fullT1 - fullT0) / 40;
      rangeCacheRef.current = {
        candles, priceMin: hm?.priceMin ?? null, priceMax: hm?.priceMax ?? null,
        segments: historyVersion, fYMin, fYMax, candleStep,
      };
    }
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
      // Сначала — догруженные куски истории (каждый со своей сеткой времени и
      // цен), затем поверх живое окно. Без этого при скролле влево оставались
      // одни свечи: карта лимиток заканчивалась на границе исходного окна.
      const sig = `${minT}:${gamma}`;
      if (segOffscreenRef.current.sig !== sig) {
        segOffscreenRef.current = { sig, map: new Map() };
      }
      const segMap = segOffscreenRef.current.map;
      ctx.imageSmoothingEnabled = false;
      for (const seg of historySegmentsRef.current) {
        const shm = seg.heatmap;
        if (!shm || !shm.cols || !shm.times.length) continue;
        const segT0 = shm.times[0];
        const segT1 = shm.times[shm.cols - 1];
        if (segT1 < t0 || segT0 > t1) continue; // целиком за пределами видимого окна
        let raster = segMap.get(seg.from);
        if (!raster) {
          raster = buildOffscreen(shm, minT, gamma);
          segMap.set(seg.from, raster);
        }
        const x0 = sx(segT0);
        const x1 = sx(segT1);
        const yTop = sy(shm.priceMax);
        const yBot = sy(shm.priceMin);
        ctx.drawImage(
          raster,
          0, 0, shm.cols, shm.bins,
          x0, yTop, Math.max(1, x1 - x0), Math.max(1, yBot - yTop),
        );
      }
      ctx.imageSmoothingEnabled = true;

      if (hm) {
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
      } // if (hm)
    }
    ctx.restore();

    if (hm && hm.profileMax > 0) {
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

    const fp = mergedFootprint;

    // Профиль объёма — ПОД свечами и кластерами: это фон с уровнями, поверх
    // него всё остальное должно читаться. Считается по видимому окну из
    // footprint (реальный объём по каждой цене), а не берётся из панели:
    // панель показывает фиксированный период, не связанный с тем, что на
    // экране после зума/панорамы.
    if (showVpOverlay && fp) {
      drawVolumeProfileOverlay(ctx, sy, plotX, plotW, plotH, profileFromFootprint(fp.candles, t0, t1));
    }

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
      const fpCache = footprintRowsCacheRef.current;
      let byCandle: Map<number, { rows: Map<number, { buy: number; sell: number }>; cMax: number }>;
      if (fpCache && fpCache.fp === fp && fpCache.rowPx === rowPx && fpCache.yMin === yMin && fpCache.yMax === yMax && fpCache.plotH === plotH) {
        byCandle = fpCache.byCandle;
      } else {
        byCandle = new Map();
        for (const fc2 of fp.candles) {
          const rows = new Map<number, { buy: number; sell: number }>();
          for (const lvl of fc2.levels) {
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
          byCandle.set(fc2.t, { rows, cMax });
        }
        footprintRowsCacheRef.current = { fp, rowPx, yMin, yMax, plotH, byCandle };
      }
      for (const fc of fp.candles) {
        const x0 = sx(fc.t + fp.interval / 2);
        if (x0 < plotX - colW || x0 > plotX + plotW + colW) continue;
        const agg = byCandle.get(fc.t);
        if (!agg || agg.cMax <= 0) continue;
        const { rows, cMax } = agg;
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
        drawDrawings(ctx, sx, sy, plotX, plotW, plotH, adjusted, selectedDrawingId, layout, candles);
      } else {
        drawDrawings(ctx, sx, sy, plotX, plotW, plotH, drawings, selectedDrawingId, layout, candles);
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

    const last = candles.length ? candles[candles.length - 1].c : (hm?.price ?? 0);
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

      const hmX0 = hm ? sx(hm.times[0] ?? t0) : 0;
      const hmX1 = hm ? sx(hm.times[hm.cols - 1] ?? t1) : 0;
      const insideHeatmap = !!hm &&
        cx >= Math.min(hmX0, hmX1) && cx <= Math.max(hmX0, hmX1) &&
        priceH >= hm.priceMin && priceH <= hm.priceMax;
      const colIdx = hm ? Math.max(0, Math.min(hm.cols - 1,
        Math.floor(((cx - hmX0) / Math.max(1, hmX1 - hmX0)) * hm.cols))) : 0;
      const binIdx = hm ? Math.max(0, Math.min(hm.bins - 1, Math.floor(((priceH - hm.priceMin) / (hm.priceMax - hm.priceMin || 1)) * hm.bins))) : 0;
      const vol = insideHeatmap && hm ? (hm.grid[colIdx]?.[binIdx] ?? 0) : 0;

      drawPriceCrosshairTag(ctx, priceH, cy, layout);

      const stepMs = candles.length > 1 ? candles[1].t - candles[0].t : 0;
      const cndl = stepMs ? candles.find((k) => ms >= k.t && ms < k.t + stepMs) : undefined;
      const timeLabel = fmtCrosshairLabel(cndl ? cndl.t : ms, timezone, locale);
      drawTimeCrosshairTag(ctx, timeLabel, cx, layout);

      const base = baseAsset(data.symbol);
      const hasWall = showLiq && insideHeatmap && !!hm && hm.maxVal > 0 && vol / hm.maxVal >= minT;
      if (hasWall) {
        const lines = [
          t("of.tipLimitOrder"),
          `${fmtP(priceH)} · ${fmtVal(vol)} ${base}`,
        ];
        drawTooltipBox(ctx, lines, cx, cy, layout);
      }
    }
  }, [data, minT, gamma, clusters, showLiq, showVpOverlay, showDivergence, divergenceSignals, showAbsorption, absorptionSignals, showDrawings, drawings, selectedDrawingId, t, range, timezone, locale, activeTool, drawingPoints, magnet, getMergedCandles, mergedFootprint, historyVersion]);

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
    // Без этого на любом экране с devicePixelRatio > 1 (обычное дело — Retina
    // и большинство современных мониторов, 2x) весь рисунок идёт в логических
    // координатах (W×H) поверх физического canvas размером (W*dpr)×(H*dpr) —
    // то есть буквально помещается только в левую половину буфера при dpr=2,
    // а правая половина остаётся непрокрашенной (сквозь неё виден фон
    // страницы). Именно поэтому Δ/CVD визуально "обрывался" на середине
    // ширины панели независимо от диапазона дат — основной draw() эту
    // трансформацию уже применяет, здесь её просто не было.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

  useEffect(() => {
    draw();
    drawDelta();
    const onResize = () => { draw(); drawDelta(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw, drawDelta]);

  const redrawAll = useCallback(() => {
    draw();
    drawDelta();
  }, [draw, drawDelta]);
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
    historySegmentsRef.current = [];
    segOffscreenRef.current = { sig: "", map: new Map() };
    hasMoreHistoryRef.current = true;
    earliestFetchedRef.current = null;
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
            onClick={() => setShowVpOverlay((v) => !v)}
            className={`inline-flex items-center gap-1.5 input-base py-1.5 text-sm transition ${showVpOverlay ? "text-accent border-accent/40" : "text-muted hover:border-border-strong"}`}
            title={t("of.hintVpOverlay")}
          >
            <span className={`h-3 w-3 rounded-sm border ${showVpOverlay ? "bg-accent border-accent" : "border-border-strong"}`} />
            {t("of.vpOverlay")}
            <span title={t("of.hintVpOverlay")} className="inline-flex cursor-help">
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

      {/* Пока грузятся свечи — спиннер, а не текст: раньше на их место сразу
          вставало «Данных пока нет», и первые секунды страница уверенно
          сообщала, что данных нет, хотя они ехали. Надпись остаётся только для
          случая, когда загрузка закончилась и рисовать действительно нечего. */}
      {loading && !data?.candles?.length ? (
        <BtcSpinner label={t("common.loading")} />
      ) : !data?.candles?.length && !hm ? (
        <div className="card p-10 text-center text-muted">{t("of.empty")}</div>
      ) : (
        <>
          <div
            ref={fsRef}
            // relative и fixed вместе оставлять нельзя: .relative в CSS
            // Tailwind идёт после .fixed и выигрывает — разворот оверлеем
            // (когда нативный Fullscreen API недоступен) складывал карточку
            // в полоску. Позиционированным предком для панелей внутри
            // одинаково служит и fixed.
            className={clsx(
              "card p-2",
              fsActive ? "fixed inset-0 z-50 flex flex-col rounded-none" : "relative",
            )}
            style={{ background: "#0a0b10" }}
          >
            {showDrawingEditor && selectedDrawingId && (() => {
              const d = drawings.find(dd => dd.id === selectedDrawingId);
              if (!d) return null;
              return (
                <DrawingEditor
                  drawing={d}
                  apiBase="/api/orderflow/drawings"
                  onPatched={(id, p) => setDrawings(prev => prev.map(dd => dd.id === id ? { ...dd, ...p } : dd))}
                  // eslint-disable-next-line react-hooks/refs -- вызывается по клику, не в рендере
                  onDelete={(id) => void deleteDrawingById(id)}
                  onClose={() => { setSelectedDrawingId(null); setShowDrawingEditor(false); }}
                />
              );
            })()}
            <div className={clsx("flex gap-2", fsActive ? "flex-1 min-h-0 items-stretch" : "items-start")}>
              {/* Таймфреймы отдаём панели только в фуллскрине: в обычном режиме
                  над графиком виден селект в шапке, дублировать его незачем. */}
              <DrawingToolbar activeTool={activeTool} onSelectTool={setActiveTool} magnet={magnet} onToggleMagnet={() => setMagnet(v => !v)} showDrawings={showDrawings} onToggleShowDrawings={() => setShowDrawings(v => !v)} locked={drawingsLocked} onToggleLocked={() => setDrawingsLocked(v => !v)} canUndoMove={canUndoMove} onUndoMove={handleUndoMove} timeframes={fsActive ? RANGES : undefined} activeTimeframe={range} onSelectTimeframe={setRange} />
              <div className="flex-1 min-w-0 relative">
                <FullscreenButton
                  active={fsActive}
                  onToggle={fsToggle}
                  className="absolute top-1 right-1 z-10"
                />
                <KeepAwakeButton className="absolute top-1 right-9 z-10" />
                <canvas
                  ref={canvasRef}
                  className={clsx("w-full", fsActive && "h-full")}
                  style={fsActive ? undefined : { height: "min(72vh, 720px)" }}
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
                {/* Свечи уже нарисованы, карта лимиток ещё считается — иначе
                    пустой фон читался бы как «лимиток за это окно нет». */}
                {overlaysLoading && !loadingHistory && (
                  <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    {t("of.loadingOverlays")}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-1 border-t border-border/40 pt-1">
              <div className="text-xs font-medium text-muted px-1 inline-flex items-center gap-1.5">
                {t("of.deltaCvdTitle")}
                <span title={t("of.hintDeltaCvd")} className="inline-flex cursor-help">
                  <HelpCircle size={12} className="text-faint shrink-0" />
                </span>
              </div>
              <canvas ref={deltaRef} className="w-full" style={{ height: 110 }} />
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
            <span>{t("of.maxWall")}: {fmtVal(hm?.maxVal ?? 0)}</span>
            <span className="text-faint/70">{t("of.zoomHint")}</span>
          </div>

        </>
      )}
    </div>
  );
}