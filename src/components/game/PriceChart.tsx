"use client";

// Canvas-график игрового терминала. Переиспользует примитивы
// src/lib/candlestickChart.ts (свечи, сетка, crosshair, бирки цены), а НЕ
// TradingView lightweight-charts из спеки (ADJUSTED FROM SPEC, раздел 0 п.6):
// свой canvas-движок в проекте уже есть.
//
// Что здесь СВОЁ и почему:
//
// 1. Окно просмотра имеет два состояния: null = «следим за рынком» (окно
//    едет за последней свечой) и заданное = «пользователь сам увёл график».
//    Любое взаимодействие сначала материализует текущее окно и только потом
//    его двигает — иначе на живом графике (перерисовка 4 раза в секунду)
//    зум и панорама молча не работали, как было в первой версии.
// 2. Масштаб тянется ЗА ОСИ, как в биржевых терминалах: потянул вверх по
//    правой шкале — свечи растянулись по вертикали, потянул вбок по нижней —
//    график сжался или растянулся по времени. Плюс колесо (обе оси сразу,
//    Shift — только время) и перетаскивание по полю (панорама).
// 3. Пустая полоса слева убрана: computePlotLayout() резервирует под ценовую
//    шкалу 76px СЛЕВА (это нужно другим страницам проекта), а подписи цен
//    рисуются справа.
// 4. Свеча равна минуте реального времени; более крупные таймфреймы
//    собираются из минуток агрегацией (aggregateCandles).
// 5. Объём, скользящие средние, RSI и разметка (трендовая, уровень,
//    прямоугольник) — здесь же: игроку нужен один инструмент анализа, а не
//    вкладка настроек.
//
// Слушатели мыши/колеса навешаны ОДИН раз (эффект без зависимостей) и не
// перевешиваются на каждый тик игры — иначе драг рвался бы посреди
// перетаскивания. Функция отрисовки живёт в redrawRef.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Eraser,
  Maximize2,
  Minus,
  Minus as LevelIcon,
  MousePointer2,
  MoveVertical,
  Plus,
  Radio,
  Square,
  TrendingUp,
} from "lucide-react";
import {
  CHART_COLORS,
  drawCandlesticks,
  drawCrosshair,
  drawLastPriceTag,
  drawPriceCrosshairTag,
  drawPriceGrid,
  drawTimeCrosshairTag,
  drawTooltipBox,
  fmtPriceLabel,
  PADR,
  type Candle as ChartCandle,
  type PlotLayout,
} from "@/lib/candlestickChart";
import { ema, rsi, sma } from "@/engine/market/indicators";
import type { AssetClass, GameDrawing, GameDrawingKind } from "@/engine/entities/types";
import { isMarketOpen, nextOpen } from "@/lib/game/schedule";
import { useMarketClock } from "@/lib/game/useMarketClock";
import { readTerminalPrefs, saveView, viewKey, writeTerminalPrefs } from "@/lib/game/terminalPrefs";
import { fetchCandles } from "@/lib/game/worldClient";
import Hint from "./Hint";
import { useI18n } from "@/lib/i18n/provider";

type Bar = ChartCandle & { v: number };

// Сортируем защитно: проекция времени и drawCandlesticks предполагают строго
// возрастающий порядок и молча рисуют мусор, если это не так.
function sortBars(bars: Bar[]): Bar[] {
  return [...bars].sort((a, b) => a.t - b.t);
}

// Окно просмотра задаётся НОМЕРАМИ СВЕЧЕЙ, а не временем.
//
// Ось по календарному времени выглядела сломанной: с расписанием торгов
// ночи и выходные — это часы без свечей, и в окно «260 баров по часу»
// попадало 63 бара, а остальные две трети экрана были пустотой. Настоящие
// терминалы поэтому и рисуют по свечам: закрытое время на оси места не
// занимает, а свечи стоят ровно, с одинаковым шагом.
type View = { i0: number; i1: number; y0: number; y1: number };

/** Дробный номер свечи для момента времени. */
export function slotOf(bars: ChartCandle[], stepMs: number, ms: number): number {
  const n = bars.length;
  if (n === 0) return 0;
  if (ms <= bars[0].t) return (ms - bars[0].t) / stepMs;
  if (ms >= bars[n - 1].t) return n - 1 + (ms - bars[n - 1].t) / stepMs;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= ms) lo = mid;
    else hi = mid;
  }
  // Внутри свечи — доля; в разрыве между свечами (ночь, выходные) доля
  // упирается в единицу: перерыв сжимается в стык двух соседних баров.
  return lo + Math.min(1, (ms - bars[lo].t) / stepMs);
}

/** Обратное преобразование: момент времени по дробному номеру свечи. */
export function timeOfSlot(bars: ChartCandle[], stepMs: number, slot: number): number {
  const n = bars.length;
  if (n === 0) return slot * stepMs;
  if (slot <= 0) return bars[0].t + slot * stepMs;
  if (slot >= n - 1) return bars[n - 1].t + (slot - (n - 1)) * stepMs;
  const i = Math.floor(slot);
  return bars[i].t + (slot - i) * stepMs;
}
type Tool = "cursor" | "trend" | "level" | "ray" | "rect" | "vline" | "erase";
type DragMode = "pan" | "scaleY" | "scaleX" | "draw";

// Набор таймфреймов зависит от стиля: скальперу дневной график не нужен, а
// инвестору минутный бесполезен. Раньше список был один на всех, и в
// дейтрейдинге не было ни дневного, ни недельного — «проанализировать день»
// было нечем.
export const TF_BY_STYLE: Record<string, string[]> = {
  scalping: ["1m", "5m", "15m", "1h"],
  day: ["1m", "5m", "15m", "1h", "4h", "1d"],
  swing: ["15m", "1h", "4h", "1d", "1w"],
  investing: ["1h", "4h", "1d", "1w", "1M"],
};
export const DEFAULT_TF_BY_STYLE: Record<string, string> = {
  scalping: "1m",
  day: "5m",
  swing: "1h",
  investing: "1d",
};

/**
 * Подпись на оси времени. Игровое время идёт вровень с реальным, а свечи
 * приходят с сервера с настоящими метками — поэтому и подписи настоящие:
 * внутри дня часы и минуты, на дневном и выше — дата.
 */
export function fmtChartTime(ms: number, stepMs: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (stepMs >= 7 * 24 * 60 * 60_000) return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${String(date.getFullYear()).slice(2)}`;
  if (stepMs >= 24 * 60 * 60_000) return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
  if (stepMs >= 60 * 60_000) return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:00`;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const TF_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
  "1M": 30 * 24 * 60 * 60_000,
};

const TF_LABEL: Record<string, string> = {
  "1m": "1м",
  "5m": "5м",
  "15m": "15м",
  "1h": "1ч",
  "4h": "4ч",
  "1d": "1д",
  "1w": "1н",
  "1M": "1мес",
};
const DEFAULT_VISIBLE_CANDLES = 260;
const MIN_VISIBLE_CANDLES = 8;
const MAX_VISIBLE_CANDLES = 1200;
const PAD_LEFT = 6;
const PAD_BOTTOM = 26; // полоса оси времени: за неё же тянут горизонтальный масштаб
const BODY_RATIO = 0.4;
const PRICE_PADDING = 0.08;
const PRICE_ZOOM_LIMIT = 12;
const VOLUME_SHARE = 0.18; // какую долю высоты занимает гистограмма объёма
const RSI_HEIGHT = 84;
const HIT_TOLERANCE = 6; // насколько близко надо кликнуть, чтобы попасть в разметку

const TOOLS: { id: Tool; Icon: typeof MousePointer2 }[] = [
  { id: "cursor", Icon: MousePointer2 },
  { id: "trend", Icon: TrendingUp },
  { id: "level", Icon: LevelIcon },
  { id: "ray", Icon: ArrowRight },
  { id: "rect", Icon: Square },
  { id: "vline", Icon: MoveVertical },
  { id: "erase", Icon: Eraser },
];

export default function PriceChart({
  assetId,
  currentPrice,
  symbol,
  assetClass,
  style,
  candleColors,
  drawings,
  onAddDrawing,
  onRemoveDrawing,
}: {
  assetId: string | undefined;
  currentPrice: number | undefined;
  symbol: string;
  assetClass: AssetClass | undefined;
  // Стиль торговли определяет набор таймфреймов: скальперу дневной график не
  // нужен, инвестору минутный бесполезен.
  style: string;
  candleColors?: { up: string; down: string };
  drawings: GameDrawing[];
  onAddDrawing: (drawing: GameDrawing) => void;
  onRemoveDrawing: (id: string) => void;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Расписание торгов: пока рынок закрыт, свечи не строятся, и об этом надо
  // сказать прямо — иначе замерший график читается как поломка.
  const now = useMarketClock();
  const marketOpen = assetClass && now > 0 ? isMarketOpen(assetClass, now) : true;
  const opensAt = assetClass && now > 0 && !marketOpen ? nextOpen(assetClass, now) : null;

  const timeframes = TF_BY_STYLE[style] ?? TF_BY_STYLE.day;
  const [tfState, setTf] = useState(() => DEFAULT_TF_BY_STYLE[style] ?? "5m");
  // Смена стиля меняет набор таймфреймов. Если текущий в новый набор не
  // входит, подставляем разумный по умолчанию прямо при рендере — эффект
  // здесь дал бы лишний кадр с пустым графиком.
  const tf = timeframes.includes(tfState) ? tfState : (DEFAULT_TF_BY_STYLE[style] ?? timeframes[0]);
  const [bars, setBars] = useState<Bar[]>([]);
  // Пока ряд не пришёл, поле остаётся пустым с подписью — это честнее, чем
  // показывать чужой таймфрейм и «догонять» его рывками.
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(true);
  const [tool, setTool] = useState<Tool>("cursor");
  const [showMa, setShowMa] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showRsi, setShowRsi] = useState(false);
  // Пока настройки не прочитаны, данные не грузим: эффекты первого рендера
  // видят дефолты, и без этого гейта в сеть уходит лишний запрос за чужим
  // таймфреймом, а игрок успевает увидеть не тот график (тот же приём, что
  // на форексе и карте ордеров).
  const [hydrated, setHydrated] = useState(false);

  // Чтение сохранённого — один раз, в эффекте: на сервере localStorage нет.
  useEffect(() => {
    const prefs = readTerminalPrefs();
    const savedTf = prefs.tf?.[style];
    if (savedTf && (TF_BY_STYLE[style] ?? TF_BY_STYLE.day).includes(savedTf)) setTf(savedTf);
    if (typeof prefs.showMa === "boolean") setShowMa(prefs.showMa);
    if (typeof prefs.showVolume === "boolean") setShowVolume(prefs.showVolume);
    if (typeof prefs.showRsi === "boolean") setShowRsi(prefs.showRsi);
    setHydrated(true);
    // Стиль в зависимостях не нужен: набор таймфреймов у нового стиля свой,
    // и подставлять в него сохранённый от старого — не то, чего ждут.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Тумблеры запоминаем сразу: их меняют редко, а лишний рендер тут не
  // рождается — запись идёт в эффекте.
  useEffect(() => {
    if (!hydrated) return;
    writeTerminalPrefs({ showMa, showVolume, showRsi });
  }, [hydrated, showMa, showVolume, showRsi]);

  useEffect(() => {
    if (!hydrated) return;
    const prefs = readTerminalPrefs();
    writeTerminalPrefs({ tf: { ...(prefs.tf ?? {}), [style]: tfState } });
  }, [hydrated, style, tfState]);

  // Между запросами последний бар «дышит» вслед за котировкой: иначе график
  // замирает на пятнадцать секунд, хотя цена в шапке меняется. Считаем это
  // при рендере — состояние тут заводить не за чем, значение производное.
  const liveBars = useMemo(() => {
    if (currentPrice == null || bars.length === 0) return bars;
    const last = bars[bars.length - 1];
    if (last.c === currentPrice) return bars;
    return [
      ...bars.slice(0, -1),
      { ...last, c: currentPrice, h: Math.max(last.h, currentPrice), l: Math.min(last.l, currentPrice) },
    ];
  }, [bars, currentPrice]);

  const candlesRef = useRef<Bar[]>(liveBars);
  const priceRef = useRef(currentPrice);
  const symbolRef = useRef(symbol);
  const tRef = useRef(t);
  const colorsRef = useRef(candleColors);
  const drawingsRef = useRef(drawings);
  const toolRef = useRef(tool);
  const addRef = useRef(onAddDrawing);
  const removeRef = useRef(onRemoveDrawing);
  const optionsRef = useRef({ showMa, showVolume, showRsi });

  const viewRef = useRef<View | null>(null);
  const layoutRef = useRef<PlotLayout | null>(null);
  const stepRef = useRef(TF_MS[tf] ?? 60_000);
  const hoverRef = useRef<{ mx: number; my: number } | null>(null);
  const dragRef = useRef<{ mode: DragMode; mx: number; my: number; startView: View } | null>(null);
  const draftRef = useRef<GameDrawing | null>(null);
  const redrawRef = useRef<() => void>(() => {});
  // Через ref, чтобы обработчики жестов не пересоздавались на каждой смене
  // инструмента или таймфрейма.
  const persistViewRef = useRef<() => void>(() => {});

  const visibleCandles = useCallback(() => candlesRef.current, []);

  const priceRange = useCallback((all: ChartCandle[], i0: number, i1: number) => {
    const from = Math.max(0, Math.floor(i0));
    const to = Math.min(all.length, Math.ceil(i1) + 1);
    const visible = all.slice(from, to);
    const forRange = visible.length > 0 ? visible : all;
    if (forRange.length === 0) return { y0: 0, y1: 1 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const k of forRange) {
      lo = Math.min(lo, k.l);
      hi = Math.max(hi, k.h);
    }
    const pad = (hi - lo) * PRICE_PADDING || hi * 0.01 || 1;
    return { y0: lo - pad, y1: hi + pad };
  }, []);

  const followView = useCallback(
    (all: ChartCandle[]): View => {
      // Просить больше свечей, чем есть, нельзя: на недельном и месячном
      // таймфрейме у инструмента их полтора десятка, и окно на 260 баров
      // сжимало весь ряд в левый угол, оставляя девять десятых экрана
      // пустыми. Показываем столько, сколько есть, но не меньше минимума —
      // иначе три свечи растянулись бы во весь экран.
      const rightPad = 3; // немного места справа от текущей цены
      const wanted = Math.min(
        DEFAULT_VISIBLE_CANDLES,
        Math.max(MIN_VISIBLE_CANDLES, all.length + rightPad),
      );
      const i1 = all.length + rightPad;
      const i0 = i1 - wanted;
      return { i0, i1, ...priceRange(all, i0, i1) };
    },
    [priceRange],
  );

  const clampView = useCallback(
    (v: View): View => {
      const all = visibleCandles();
      const span = Math.min(MAX_VISIBLE_CANDLES, Math.max(MIN_VISIBLE_CANDLES, v.i1 - v.i0));
      let i0 = v.i0;
      let i1 = i0 + span;
      if (all.length > 0) {
        // За край ряда пускаем на половину окна: пустое поле справа нужно,
        // чтобы было куда рисовать разметку впереди цены.
        if (i0 < -span / 2) {
          i0 = -span / 2;
          i1 = i0 + span;
        }
        if (i1 > all.length + span / 2) {
          i1 = all.length + span / 2;
          i0 = i1 - span;
        }
      }
      const natural = priceRange(all, i0, i1);
      const naturalSpan = natural.y1 - natural.y0 || 1;
      const center = (v.y0 + v.y1) / 2;
      const pSpan = Math.min(
        naturalSpan * PRICE_ZOOM_LIMIT,
        Math.max(naturalSpan / PRICE_ZOOM_LIMIT, v.y1 - v.y0 || naturalSpan),
      );
      return { i0, i1, y0: center - pSpan / 2, y1: center + pSpan / 2 };
    },
    [priceRange, visibleCandles],
  );

  const materializeView = useCallback((): View => {
    if (viewRef.current) return viewRef.current;
    const view = followView(visibleCandles());
    viewRef.current = view;
    setFollowing(false);
    return view;
  }, [followView, visibleCandles]);

  const zoomBy = useCallback(
    (factor: number) => {
      const v = materializeView();
      const iCenter = (v.i0 + v.i1) / 2;
      const iSpan = (v.i1 - v.i0) * factor;
      const pCenter = (v.y0 + v.y1) / 2;
      const pSpan = (v.y1 - v.y0) * factor;
      viewRef.current = clampView({
        i0: iCenter - iSpan / 2,
        i1: iCenter + iSpan / 2,
        y0: pCenter - pSpan / 2,
        y1: pCenter + pSpan / 2,
      });
      redrawRef.current();
    },
    [clampView, materializeView],
  );

  const resetView = useCallback(() => {
    viewRef.current = null;
    setFollowing(true);
    if (assetId) saveView(assetId, tf, null);
    redrawRef.current();
  }, [assetId, tf]);

  /**
   * Запомнить текущий масштаб.
   *
   * Вызывается по окончании жеста, а не на каждом кадре: перетаскивание
   * графика — это десятки событий в секунду, и писать в localStorage на
   * каждом из них значит подвесить главный поток ради значения, которое
   * через миллисекунду устареет.
   */
  const persistView = useCallback(() => {
    if (!assetId) return;
    const view = viewRef.current;
    saveView(assetId, tf, view ? { i0: view.i0, i1: view.i1, y0: view.y0, y1: view.y1 } : null);
  }, [assetId, tf]);

  useEffect(() => {
    persistViewRef.current = persistView;
  }, [persistView]);

  // ── Данные: свечи приходят с сервера ────────────────────────────────────
  //
  // Раньше график рисовал то, что насчитал сам браузер, — у каждого игрока
  // был свой рынок и восемь часов истории. Теперь ряд общий, лежит в базе, и
  // на длинных таймфреймах видно месяцы.
  useEffect(() => {
    if (!assetId || !hydrated) return;
    let alive = true;
    // Старый ряд убираем СРАЗУ. Иначе между кликом по таймфрейму и ответом
    // сервера график секунду рисует минутные свечи в дневном окне, потом
    // прыгает на новые данные, потом ещё раз — на пересчитанный масштаб.
    // Со стороны это читается как «страница несколько раз перезагрузилась».
    setBars([]);
    setLoading(true);
    // Окно просмотра тоже сбрасываем: границы, посчитанные для минуток, на
    // дневном ряду бессмысленны.
    // Восстанавливаем сохранённый масштаб для этой пары «инструмент —
    // таймфрейм». Ничего не сохранено — идём в автоматический режим.
    const saved = readTerminalPrefs().views?.[viewKey(assetId, tf)];
    viewRef.current = saved ?? null;
    setFollowing(saved == null);

    const load = async () => {
      const data = await fetchCandles(assetId, tf, 400);
      if (!alive) return;
      setBars(data.map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v })));
      setLoading(false);
    };
    void load();
    // Внутридневные ряды обновляем чаще: там бар живёт минуты. На дневном и
    // выше перезапрашивать чаще раза в минуту незачем.
    const period = (TF_MS[tf] ?? 60_000) < 60 * 60 * 1000 ? 15_000 : 60_000;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void load();
    }, period);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [assetId, tf, hydrated]);

  // ── Отрисовка ───────────────────────────────────────────────────────────
  useEffect(() => {
    candlesRef.current = liveBars;
    priceRef.current = currentPrice;
    symbolRef.current = symbol;
    tRef.current = t;
    colorsRef.current = candleColors;
    drawingsRef.current = drawings;
    toolRef.current = tool;
    addRef.current = onAddDrawing;
    removeRef.current = onRemoveDrawing;
    optionsRef.current = { showMa, showVolume, showRsi };

    const draw = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const dpr = window.devicePixelRatio || 1;
      const W = container.clientWidth;
      const H = container.clientHeight;
      if (W === 0 || H === 0) return;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const rsiH = optionsRef.current.showRsi ? RSI_HEIGHT : 0;
      const layout: PlotLayout = {
        plotX: PAD_LEFT,
        plotW: Math.max(10, W - PAD_LEFT - PADR),
        plotH: H - PAD_BOTTOM - rsiH,
        W,
        H,
      };
      layoutRef.current = layout;

      const allCandles = sortBars(liveBars);
      if (allCandles.length < 2) {
        ctx.fillStyle = CHART_COLORS.axisTextWeak;
        ctx.font = "12px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText(tRef.current("game.chart.loading"), W / 2, H / 2);
        ctx.textAlign = "left";
        return;
      }

      // Шаг берём ИЗ ТАЙМФРЕЙМА, а не из первых двух свечей ряда.
      //
      // Разница принципиальная с тех пор, как появилось расписание торгов:
      // ряд начинается там, где начинается история инструмента, и это часто
      // последний час сессии — расстояние до следующей свечи там не час, а
      // восемнадцать. С таким «шагом» центр свечи (t + шаг/2) уезжал на
      // шесть баров вперёд, и все свечи сессии рисовались одна на другой.
      const stepMs = TF_MS[tf] ?? 60_000;
      stepRef.current = stepMs;

      const view = viewRef.current ?? followView(allCandles);
      // Всё по горизонтали считается в номерах свечей: перерыв в торгах —
      // это отсутствующие бары, а не пустое место на оси.
      const xspan = view.i1 - view.i0 || 1;
      const sxSlot = (slot: number) => layout.plotX + ((slot - view.i0) / xspan) * layout.plotW;
      const sx = (ms: number) => sxSlot(slotOf(allCandles, stepMs, ms));
      const barW = layout.plotW / xspan;
      const yMin = view.y0;
      const yMax = view.y1;
      const yspan = yMax - yMin || 1;
      const sy = (p: number) => layout.plotH - ((p - yMin) / yspan) * layout.plotH;
      const invX = (x: number) =>
        timeOfSlot(allCandles, stepMs, view.i0 + ((x - layout.plotX) / layout.plotW) * xspan);
      const invY = (y: number) => yMin + (1 - y / layout.plotH) * yspan;

      drawPriceGrid(ctx, layout, yMin, yMax, sy);

      // Вертикальная сетка: ось X — игровое время симуляции.
      ctx.strokeStyle = CHART_COLORS.gridWeak;
      ctx.fillStyle = CHART_COLORS.axisTextWeak;
      ctx.font = "10px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      const ticks = Math.max(3, Math.min(8, Math.floor(layout.plotW / 130)));
      for (let i = 0; i <= ticks; i++) {
        const slot = view.i0 + (xspan * i) / ticks;
        const ms = timeOfSlot(allCandles, stepMs, slot);
        const x = sxSlot(slot);
        if (x < layout.plotX - 1 || x > layout.plotX + layout.plotW + 1) continue;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, layout.plotH);
        ctx.stroke();
        ctx.fillText(fmtChartTime(ms, stepMs), x, layout.plotH + 16);
      }
      ctx.textAlign = "left";

      ctx.save();
      ctx.beginPath();
      ctx.rect(layout.plotX, 0, layout.plotW, layout.plotH);
      ctx.clip();

      // Объём — под свечами, полупрозрачной гистограммой в нижней части поля.
      if (optionsRef.current.showVolume) {
        const visible = allCandles.slice(Math.max(0, Math.floor(view.i0)), Math.ceil(view.i1) + 1);
        const maxVolume = visible.reduce((max, k) => Math.max(max, k.v), 0);
        if (maxVolume > 0) {
          const zone = layout.plotH * VOLUME_SHARE;
          const width = Math.max(1, barW * BODY_RATIO);
          for (const k of visible) {
            const height = (k.v / maxVolume) * zone;
            const up = k.c >= k.o;
            ctx.fillStyle = up ? (colorsRef.current?.up ?? CHART_COLORS.up) : (colorsRef.current?.down ?? CHART_COLORS.down);
            ctx.globalAlpha = 0.25;
            ctx.fillRect(sx(k.t + stepMs / 2) - width / 2, layout.plotH - height, width, height);
          }
          ctx.globalAlpha = 1;
        }
      }

      drawCandlesticks(ctx, allCandles, sx, sy, layout.plotX, layout.plotW, xspan, {
        bodyRatio: BODY_RATIO,
        // Ширина задаётся явно: вывести её из stepMs/xspan нельзя — ось
        // идёт по номерам свечей, а не по миллисекундам.
        bodyWidth: barW * BODY_RATIO,
        // И шаг тоже: внутри рисовальщика он иначе выводится из первых двух
        // свечей и наступает на те же грабли.
        stepMs,
        up: colorsRef.current?.up,
        down: colorsRef.current?.down,
      });

      // Скользящие средние поверх свечей.
      if (optionsRef.current.showMa) {
        const lines: [ReturnType<typeof sma>, string][] = [
          [sma(allCandles, 20), "#38bdf8"],
          [ema(allCandles, 50), "#f59e0b"],
        ];
        for (const [points, color] of lines) {
          if (points.length < 2) continue;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          points.forEach((point, i) => {
            const x = sx(point.t + stepMs / 2);
            const y = sy(point.value);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }

      // Разметка игрока + черновик под курсором.
      const items = [...drawingsRef.current];
      if (draftRef.current) items.push(draftRef.current);
      for (const item of items) {
        ctx.strokeStyle = CHART_COLORS.drawing;
        ctx.lineWidth = 1.5;
        if (item.kind === "level" && item.points[0]) {
          const y = sy(item.points[0].price);
          ctx.beginPath();
          ctx.moveTo(layout.plotX, y);
          ctx.lineTo(layout.plotX + layout.plotW, y);
          ctx.stroke();
        } else if (item.kind === "ray" && item.points[0]) {
          // Луч: от точки вправо до края — уровень, который начал
          // действовать с определённого момента, а не «всегда был».
          const y = sy(item.points[0].price);
          ctx.beginPath();
          ctx.moveTo(sx(item.points[0].t), y);
          ctx.lineTo(layout.plotX + layout.plotW, y);
          ctx.stroke();
        } else if (item.kind === "vline" && item.points[0]) {
          const x = sx(item.points[0].t);
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, layout.plotH);
          ctx.stroke();
        } else if (item.kind === "trend" && item.points.length === 2) {
          ctx.beginPath();
          ctx.moveTo(sx(item.points[0].t), sy(item.points[0].price));
          ctx.lineTo(sx(item.points[1].t), sy(item.points[1].price));
          ctx.stroke();
        } else if (item.kind === "rect" && item.points.length === 2) {
          const x0 = sx(item.points[0].t);
          const x1 = sx(item.points[1].t);
          const y0 = sy(item.points[0].price);
          const y1 = sy(item.points[1].price);
          ctx.fillStyle = "rgba(56,189,248,0.10)";
          ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
          ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        }
      }
      ctx.lineWidth = 1;
      ctx.restore();

      const price = priceRef.current;
      if (price != null) drawLastPriceTag(ctx, price, sy(price), layout);

      ctx.font = "600 14px ui-sans-serif, system-ui";
      ctx.fillStyle = "rgba(230,233,240,0.72)";
      ctx.textAlign = "left";
      ctx.fillText(symbolRef.current, layout.plotX + 10, 20);

      // RSI отдельной полосой снизу: накладывать осциллятор на цену нельзя,
      // у него своя шкала 0-100.
      if (optionsRef.current.showRsi) {
        const top = layout.plotH + PAD_BOTTOM;
        const points = rsi(allCandles, 14);
        ctx.strokeStyle = CHART_COLORS.gridWeak;
        ctx.beginPath();
        ctx.moveTo(layout.plotX, top);
        ctx.lineTo(layout.plotX + layout.plotW, top);
        ctx.stroke();
        const ry = (value: number) => top + 8 + (1 - value / 100) * (RSI_HEIGHT - 16);
        for (const level of [30, 70]) {
          ctx.strokeStyle = CHART_COLORS.gridWeak;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(layout.plotX, ry(level));
          ctx.lineTo(layout.plotX + layout.plotW, ry(level));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = CHART_COLORS.axisTextWeak;
          ctx.font = "9px ui-sans-serif, system-ui";
          ctx.fillText(String(level), layout.plotX + layout.plotW + 5, ry(level) + 3);
        }
        if (points.length > 1) {
          ctx.strokeStyle = "#a855f7";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          points.forEach((point, i) => {
            const x = sx(point.t + stepMs / 2);
            const y = ry(point.value);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
          ctx.lineWidth = 1;
        }
        ctx.fillStyle = CHART_COLORS.axisTextWeak;
        ctx.font = "10px ui-sans-serif, system-ui";
        ctx.fillText("RSI 14", layout.plotX + 6, top + 12);
      }

      // Crosshair + OHLC-подсказка.
      const hov = hoverRef.current;
      if (hov && hov.mx >= layout.plotX && hov.mx <= layout.plotX + layout.plotW && hov.my >= 0 && hov.my <= layout.plotH) {
        drawCrosshair(ctx, hov.mx, hov.my, layout);
        drawPriceCrosshairTag(ctx, invY(hov.my), hov.my, layout);
        const ms = invX(hov.mx);
        const candle = allCandles.find((k) => ms >= k.t && ms < k.t + stepMs);
        drawTimeCrosshairTag(ctx, fmtChartTime(candle ? candle.t : ms, stepMs), hov.mx, layout);
        if (candle) {
          drawTooltipBox(
            ctx,
            [
              `O ${fmtPriceLabel(candle.o)}  H ${fmtPriceLabel(candle.h)}`,
              `L ${fmtPriceLabel(candle.l)}  C ${fmtPriceLabel(candle.c)}`,
              `V ${Math.round(candle.v).toLocaleString("ru-RU")}`,
            ],
            hov.mx,
            hov.my,
            layout,
          );
        }
      }
    };

    redrawRef.current = draw;
    draw();
  }, [
    liveBars,
    currentPrice,
    symbol,
    t,
    candleColors,
    tf,
    followView,
    drawings,
    tool,
    onAddDrawing,
    onRemoveDrawing,
    showMa,
    showVolume,
    showRsi,
  ]);

  // ── Взаимодействие ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ro = new ResizeObserver(() => redrawRef.current());
    ro.observe(container);

    /** Где именно нажали: поле, ценовая шкала справа или ось времени снизу. */
    const zoneOf = (mx: number, my: number): DragMode => {
      const lay = layoutRef.current;
      if (!lay) return "pan";
      if (mx > lay.plotX + lay.plotW) return "scaleY";
      if (my > lay.plotH && my <= lay.plotH + PAD_BOTTOM) return "scaleX";
      return "pan";
    };

    const dataAt = (mx: number, my: number) => {
      const lay = layoutRef.current;
      const view = viewRef.current;
      if (!lay || !view) return null;
      const xspan = view.i1 - view.i0 || 1;
      const yspan = view.y1 - view.y0 || 1;
      const bars = candlesRef.current;
      const stepMs = stepRef.current || 60_000;
      return {
        t: timeOfSlot(bars, stepMs, view.i0 + ((mx - lay.plotX) / lay.plotW) * xspan),
        price: view.y0 + (1 - my / lay.plotH) * yspan,
      };
    };

    /** Ближайшая разметка к точке — для ластика. */
    const hitDrawing = (mx: number, my: number): GameDrawing | null => {
      const lay = layoutRef.current;
      const view = viewRef.current;
      if (!lay || !view) return null;
      const xspan = view.i1 - view.i0 || 1;
      const yspan = view.y1 - view.y0 || 1;
      const bars = candlesRef.current;
      const stepMs = stepRef.current || 60_000;
      const sx = (ms: number) => lay.plotX + ((slotOf(bars, stepMs, ms) - view.i0) / xspan) * lay.plotW;
      const sy = (p: number) => lay.plotH - ((p - view.y0) / yspan) * lay.plotH;
      for (const item of [...drawingsRef.current].reverse()) {
        if (item.kind === "level" && item.points[0]) {
          if (Math.abs(sy(item.points[0].price) - my) <= HIT_TOLERANCE) return item;
        } else if (item.kind === "ray" && item.points[0]) {
          // Луч тянется от своей точки вправо: попадание считаем только
          // правее начала.
          if (Math.abs(sy(item.points[0].price) - my) <= HIT_TOLERANCE && mx >= sx(item.points[0].t) - HIT_TOLERANCE) return item;
        } else if (item.kind === "vline" && item.points[0]) {
          if (Math.abs(sx(item.points[0].t) - mx) <= HIT_TOLERANCE) return item;
        } else if (item.kind === "trend" && item.points.length === 2) {
          const x1 = sx(item.points[0].t);
          const y1 = sy(item.points[0].price);
          const x2 = sx(item.points[1].t);
          const y2 = sy(item.points[1].price);
          const dx = x2 - x1;
          const dy = y2 - y1;
          const lengthSq = dx * dx + dy * dy || 1;
          const u = Math.max(0, Math.min(1, ((mx - x1) * dx + (my - y1) * dy) / lengthSq));
          const dist = Math.hypot(mx - (x1 + u * dx), my - (y1 + u * dy));
          if (dist <= HIT_TOLERANCE) return item;
        } else if (item.kind === "rect" && item.points.length === 2) {
          const xs = [sx(item.points[0].t), sx(item.points[1].t)].sort((a, b) => a - b);
          const ys = [sy(item.points[0].price), sy(item.points[1].price)].sort((a, b) => a - b);
          if (mx >= xs[0] - HIT_TOLERANCE && mx <= xs[1] + HIT_TOLERANCE && my >= ys[0] - HIT_TOLERANCE && my <= ys[1] + HIT_TOLERANCE) {
            return item;
          }
        }
      }
      return null;
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      hoverRef.current = { mx, my };
      const drag = dragRef.current;
      const lay = layoutRef.current;

      if (!drag && lay) {
        // Курсор подсказывает, что произойдёт при нажатии.
        const zone = zoneOf(mx, my);
        canvas.style.cursor =
          toolRef.current !== "cursor" ? "crosshair" : zone === "scaleY" ? "ns-resize" : zone === "scaleX" ? "ew-resize" : "crosshair";
      }

      if (drag && lay) {
        if (drag.mode === "pan") {
          const span = drag.startView.i1 - drag.startView.i0;
          const di = ((mx - drag.mx) / lay.plotW) * span;
          const pspan = drag.startView.y1 - drag.startView.y0;
          const dp = ((my - drag.my) / lay.plotH) * pspan;
          viewRef.current = clampView({
            i0: drag.startView.i0 - di,
            i1: drag.startView.i1 - di,
            y0: drag.startView.y0 + dp,
            y1: drag.startView.y1 + dp,
          });
        } else if (drag.mode === "scaleY") {
          // Тянем вверх по ценовой шкале — окно цен сужается, свечи
          // растягиваются по вертикали. Экспонента, чтобы движение
          // ощущалось одинаково в любом масштабе.
          const factor = Math.exp((my - drag.my) / 220);
          const span = (drag.startView.y1 - drag.startView.y0) * factor;
          const center = (drag.startView.y0 + drag.startView.y1) / 2;
          viewRef.current = clampView({ ...drag.startView, y0: center - span / 2, y1: center + span / 2 });
        } else if (drag.mode === "scaleX") {
          // По оси времени: вправо — растягиваем (свечей меньше, они шире),
          // влево — сжимаем и видим больше истории.
          const factor = Math.exp((drag.mx - mx) / 220);
          const span = (drag.startView.i1 - drag.startView.i0) * factor;
          // Правый край (текущая цена) остаётся на месте — так ведут себя
          // биржевые терминалы.
          viewRef.current = clampView({ ...drag.startView, i0: drag.startView.i1 - span });
        } else if (drag.mode === "draw" && draftRef.current) {
          const point = dataAt(mx, my);
          if (point) {
            const draft = draftRef.current;
            draft.points =
              draft.kind === "level" || draft.kind === "ray" || draft.kind === "vline"
                ? [point]
                : [draft.points[0], point];
          }
        }
      }
      redrawRef.current();
    };

    const onDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const view = materializeView();
      const active = toolRef.current;

      if (active === "erase") {
        const hit = hitDrawing(mx, my);
        if (hit) removeRef.current(hit.id);
        redrawRef.current();
        return;
      }

      if (active !== "cursor") {
        const point = dataAt(mx, my);
        if (point) {
          const singlePoint = active === "level" || active === "ray" || active === "vline";
          draftRef.current = {
            id: crypto.randomUUID(),
            kind: active as GameDrawingKind,
            points: singlePoint ? [point] : [point, point],
          };
          dragRef.current = { mode: "draw", mx, my, startView: { ...view } };
        }
        return;
      }

      dragRef.current = { mode: zoneOf(mx, my), mx, my, startView: { ...view } };
      if (dragRef.current.mode === "pan") canvas.style.cursor = "grabbing";
    };

    const onUp = () => {
      const draft = draftRef.current;
      if (draft) {
        // Случайный клик тем же инструментом не должен оставлять точку
        // нулевой длины: у линии и прямоугольника концы обязаны различаться.
        const singlePoint = draft.kind === "level" || draft.kind === "ray" || draft.kind === "vline";
        const meaningful =
          singlePoint ||
          (draft.points.length === 2 && (draft.points[0].t !== draft.points[1].t || draft.points[0].price !== draft.points[1].price));
        if (meaningful) addRef.current(draft);
        draftRef.current = null;
        // Инструмент отжимается сам: нарисовал уровень — вернулся курсор.
        // Иначе следующий клик по графику ставит ещё одну линию, хотя
        // человек просто хотел посмотреть цену под курсором.
        setTool("cursor");
      }
      dragRef.current = null;
      canvas.style.cursor = "crosshair";
      // Жест закончился — запоминаем масштаб.
      persistViewRef.current();
      redrawRef.current();
    };

    const onLeave = () => {
      hoverRef.current = null;
      redrawRef.current();
    };

    const onDouble = () => {
      viewRef.current = null;
      setFollowing(true);
      persistViewRef.current();
      redrawRef.current();
    };

    const onWheel = (e: WheelEvent) => {
      const lay = layoutRef.current;
      if (!lay) return;
      e.preventDefault();
      const v = materializeView();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      const fx = Math.min(1, Math.max(0, (mx - lay.plotX) / lay.plotW));
      const fy = Math.min(1, Math.max(0, my / lay.plotH));
      const iCursor = v.i0 + fx * (v.i1 - v.i0);
      const iSpan = (v.i1 - v.i0) * factor;
      let next: View = { ...v, i0: iCursor - fx * iSpan, i1: iCursor + (1 - fx) * iSpan };
      if (!e.shiftKey) {
        const pCursor = v.y1 - fy * (v.y1 - v.y0);
        const pSpan = (v.y1 - v.y0) * factor;
        next = { ...next, y1: pCursor + fy * pSpan, y0: pCursor - (1 - fy) * pSpan };
      }
      viewRef.current = clampView(next);
      persistViewRef.current();
      redrawRef.current();
    };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("dblclick", onDouble);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.style.cursor = "crosshair";

    return () => {
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("dblclick", onDouble);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [clampView, materializeView]);

  const toolButton = "px-2 py-1 rounded-md text-xs font-medium transition";

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
        {opensAt != null && (
          <span
            className="rounded-md bg-surface-2 px-2 py-1 text-[11px] font-medium text-muted"
            title={t("game.chart.marketClosedHint")}
          >
            {t("game.chart.marketClosed", {
              when: new Date(opensAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }),
            })}
          </span>
        )}
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {timeframes.map((code) => (
            <Hint key={code} text={t(`game.chart.tf.${code}.hint`)}>
              <button
                type="button"
                onClick={() => setTf(code)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  tf === code ? "bg-accent text-white" : "text-muted hover:text-fg"
                }`}
              >
                {TF_LABEL[code] ?? code}
              </button>
            </Hint>
          ))}
        </div>

        {/* Инструменты разметки — те же, что на форексе и карте ордеров. */}
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {TOOLS.map(({ id, Icon }) => (
            <Hint key={id} text={t(`game.chart.tool.${id}.hint`)}>
              <button
                type="button"
                onClick={() => setTool(id)}
                aria-label={t(`game.chart.tool.${id}`)}
                className={`${toolButton} ${tool === id ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
              >
                <Icon size={13} />
              </button>
            </Hint>
          ))}
        </div>

        <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {(
            [
              ["ma", showMa, setShowMa],
              ["volume", showVolume, setShowVolume],
              ["rsi", showRsi, setShowRsi],
            ] as const
          ).map(([key, value, set]) => (
            <Hint key={key} text={t(`game.chart.indicator.${key}.hint`)}>
              <button
                type="button"
                onClick={() => set(!value)}
                className={`${toolButton} ${value ? "bg-accent/20 text-accent" : "text-muted hover:text-fg"}`}
              >
                {t(`game.chart.indicator.${key}`)}
              </button>
            </Hint>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button type="button" className={`${toolButton} text-muted hover:text-fg`} onClick={() => zoomBy(1.4)} title={t("game.chart.zoomOut")}>
            <Minus size={14} />
          </button>
          <button type="button" className={`${toolButton} text-muted hover:text-fg`} onClick={() => zoomBy(0.7)} title={t("game.chart.zoomIn")}>
            <Plus size={14} />
          </button>
          <button
            type="button"
            className={`${toolButton} inline-flex items-center gap-1 ${following ? "text-accent" : "text-muted hover:text-fg"}`}
            onClick={resetView}
            title={t("game.chart.resetHint")}
          >
            {following ? <Radio size={14} /> : <Maximize2 size={14} />}
            {following ? t("game.chart.live") : t("game.chart.backToPrice")}
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative min-h-[240px] flex-1">
        <canvas ref={canvasRef} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-faint">
            {t("game.chart.loading")}
          </div>
        )}
      </div>

      <div className="px-1 pt-1 text-[11px] text-faint">{t("game.chart.hint")}</div>
    </div>
  );
}
