"use client";

// Canvas-график цены игрового терминала. Переиспользует примитивы
// src/lib/candlestickChart.ts (свечи, сетка, crosshair, бирки цены), а НЕ
// TradingView lightweight-charts из спеки (ADJUSTED FROM SPEC, раздел 0 п.6):
// свой canvas-движок в проекте уже есть, третья ~45kb зависимость ради
// одного графика неоправданна.
//
// Что здесь СВОЁ и почему (переделано после разбора с пользователем: «в
// график нельзя растянуть, стянуть, переместить, какие-то большие отступы
// слева, какие это таймфреймы непонятно»):
//
// 1. Окно просмотра (view) имеет ДВА состояния: null = «следим за рынком»
//    (окно едет за последней свечой) и заданное = «пользователь сам увёл
//    график». Раньше окно один раз выставлялось по всей истории и потом не
//    двигалось: новые свечи уезжали за правый край, график выглядел
//    замершим, а обработчики зума/панорамы выходили по `if (!viewRef.current)
//    return` — то есть на живом графике зум и панорама не работали ВООБЩЕ.
//    Теперь любое взаимодействие сначала материализует текущее окно
//    (viewFromFollow) и только потом его двигает.
// 2. Пустая полоса слева убрана: computePlotLayout() резервирует под ценовую
//    шкалу 76px СЛЕВА (это нужно другим страницам проекта), а подписи цен
//    рисуются справа — на игровом графике эти 84px были просто пустотой.
//    Здесь раскладка считается своя, с минимальным левым отступом.
// 3. Таймфрейм: свеча движка привязана к ускорению стиля, поэтому «1 бар» в
//    скальпинге и в инвестициях — это разное игровое время. Селектор
//    агрегирует базовые свечи по 1/5/15/60 и подписывает результат в
//    игровом времени (1м, 15м, 1ч, 12ч, 30д), чтобы вопрос «какой это
//    таймфрейм» вообще не возникал.
//
// Слушатели мыши/колеса навешаны ОДИН раз (эффект без зависимостей) и не
// перевешиваются на каждый тик игры (~4Hz) — иначе драг рвался бы посреди
// перетаскивания. Функция отрисовки живёт в redrawRef и обновляется отдельным
// эффектом, поэтому листенеры не ловят устаревшее замыкание.
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus, Radio } from "lucide-react";
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
  PADB,
  PADR,
  type Candle as ChartCandle,
  type PlotLayout,
} from "@/lib/candlestickChart";
import type { Candle as EngineCandle } from "@/engine/entities/types";
import { fmtGameClock, fmtGameDuration } from "@/lib/gameTime";
import { useI18n } from "@/lib/i18n/provider";

// Сортируем защитно: проекция времени и drawCandlesticks предполагают строго
// возрастающий порядок и молча рисуют мусор, если это не так (см. фиксы в
// gameStore.ts/gameLoop.ts — это вторая линия обороны).
function toChartCandles(candles: EngineCandle[]): ChartCandle[] {
  return [...candles]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((c) => ({ t: c.timestamp, o: c.open, h: c.high, l: c.low, c: c.close }));
}

/** Склейка базовых свечей по `factor` штук в одну (таймфрейм графика). */
export function aggregateCandles(candles: ChartCandle[], baseIntervalMs: number, factor: number): ChartCandle[] {
  if (factor <= 1 || candles.length === 0) return candles;
  const bucketMs = baseIntervalMs * factor;
  const out: ChartCandle[] = [];
  let current: ChartCandle | null = null;
  let currentBucket = NaN;
  for (const k of candles) {
    const bucket = Math.floor(k.t / bucketMs) * bucketMs;
    if (!current || bucket !== currentBucket) {
      if (current) out.push(current);
      current = { t: bucket, o: k.o, h: k.h, l: k.l, c: k.c };
      currentBucket = bucket;
      continue;
    }
    current.h = Math.max(current.h, k.h);
    current.l = Math.min(current.l, k.l);
    current.c = k.c;
  }
  if (current) out.push(current);
  return out;
}

// Окно просмотра — как на форексе и карте ордеров (ChartView в
// lib/useChartInteractions.ts): ЦЕНОВАЯ ось входит в окно наравне со
// временем. Раньше игровой график подгонял цену под видимые свечи на каждом
// кадре — при живом тике (4 раза в секунду) вертикальный масштаб дёргался
// сам по себе, и свечи «дышали», хотя пользователь ничего не делал.
type View = { t0: number; t1: number; y0: number; y1: number };

const TF_FACTORS = [1, 5, 15, 60];
// Столько баров видно в режиме слежения. На форексе это 300-480 (VISIBLE_CANDLES
// в ForexView.tsx) — берём тот же порядок, чтобы свечи были такой же
// «плотности», а не в три раза толще, как было при 90.
const DEFAULT_VISIBLE_CANDLES = 260;
const MIN_VISIBLE_CANDLES = 8; // ближе не зумим — дальше это уже не график
const MAX_VISIBLE_CANDLES = 1200; // дальше некуда: истории всё равно 500 баров
const PAD_LEFT = 6; // вместо 84px пустоты из computePlotLayout
// Тело свечи занимает 40% шага — ровно как на форексе (drawCandlesticks
// вызывается там с bodyRatio: 0.4). При дефолтных 0.7 свечи выглядели
// толстыми и «игрушечными» рядом с остальными графиками проекта.
const BODY_RATIO = 0.4;
// Насколько ценовое окно шире реального диапазона свечей при автоподгоне.
const PRICE_PADDING = 0.08;
const PRICE_ZOOM_LIMIT = 12; // во столько раз можно растянуть/сжать цену

export default function PriceChart({
  candles,
  currentPrice,
  symbol,
  candleColors,
  baseIntervalMs,
}: {
  candles: EngineCandle[];
  currentPrice: number | undefined;
  symbol: string;
  // Цвета свечей купленной в магазине темы (раздел 13). undefined — цвета по
  // умолчанию, те же, что у форекса/карты ордеров.
  candleColors?: { up: string; down: string };
  // Сколько ИГРОВОГО времени в одной базовой свече — зависит от ускорения
  // активного стиля (candleIntervalMs в gameLoop.ts). Нужен только для
  // подписи таймфрейма и агрегации.
  baseIntervalMs: number;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [tfFactor, setTfFactor] = useState(1);
  // Только для кнопки «вернуться к рынку»: сам режим слежения живёт в
  // viewRef (перерисовка идёт вне React, состояние — чтобы перерисовать
  // панель инструментов).
  const [following, setFollowing] = useState(true);

  const candlesRef = useRef(candles);
  const priceRef = useRef(currentPrice);
  const symbolRef = useRef(symbol);
  const tRef = useRef(t);
  const colorsRef = useRef(candleColors);
  const tfRef = useRef(tfFactor);
  const baseIntervalRef = useRef(baseIntervalMs);

  const viewRef = useRef<View | null>(null); // null = следим за последней свечой
  const layoutRef = useRef<PlotLayout | null>(null);
  const stepRef = useRef(baseIntervalMs); // шаг ВИДИМЫХ (агрегированных) свечей
  const hoverRef = useRef<{ mx: number; my: number } | null>(null);
  const dragRef = useRef<{ mx: number; my: number; startView: View } | null>(null);
  const redrawRef = useRef<() => void>(() => {});

  /** Видимые свечи текущего таймфрейма. */
  const visibleCandles = useCallback((): ChartCandle[] => {
    return aggregateCandles(toChartCandles(candlesRef.current), baseIntervalRef.current, tfRef.current);
  }, []);

  /** Диапазон цен по свечам, попавшим в окно [t0, t1], с полями сверху и снизу. */
  const priceRange = useCallback((all: ChartCandle[], t0: number, t1: number, stepMs: number): { y0: number; y1: number } => {
    const visible = all.filter((k) => k.t + stepMs >= t0 && k.t <= t1);
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

  /** Окно в режиме слежения: последние DEFAULT_VISIBLE_CANDLES баров, цена — по ним же. */
  const followView = useCallback((all: ChartCandle[], stepMs: number): View => {
    const lastT = all.length > 0 ? all[all.length - 1].t : 0;
    const t1 = lastT + stepMs;
    const t0 = t1 - stepMs * DEFAULT_VISIBLE_CANDLES;
    return { t0, t1, ...priceRange(all, t0, t1, stepMs) };
  }, [priceRange]);

  const clampView = useCallback((v: View): View => {
    const all = visibleCandles();
    const stepMs = stepRef.current || 1;
    const span = Math.min(
      stepMs * MAX_VISIBLE_CANDLES,
      Math.max(stepMs * MIN_VISIBLE_CANDLES, v.t1 - v.t0),
    );
    let t0 = v.t0;
    let t1 = t0 + span;
    if (all.length > 0) {
      const fullT0 = all[0].t;
      const fullT1 = all[all.length - 1].t + stepMs;
      // Не даём уехать дальше, чем на пол-экрана за пределы истории: график,
      // улетевший в пустоту, выглядит как поломка.
      if (t0 < fullT0 - span / 2) {
        t0 = fullT0 - span / 2;
        t1 = t0 + span;
      }
      if (t1 > fullT1 + span / 2) {
        t1 = fullT1 + span / 2;
        t0 = t1 - span;
      }
    }
    // Цену тоже ограничиваем — иначе колесом можно «сплющить» окно в линию
    // или растянуть так, что свечи превращаются в точку у края.
    const natural = priceRange(all, t0, t1, stepMs);
    const naturalSpan = natural.y1 - natural.y0 || 1;
    const center = (v.y0 + v.y1) / 2;
    const pSpan = Math.min(
      naturalSpan * PRICE_ZOOM_LIMIT,
      Math.max(naturalSpan / PRICE_ZOOM_LIMIT, v.y1 - v.y0 || naturalSpan),
    );
    return { t0, t1, y0: center - pSpan / 2, y1: center + pSpan / 2 };
  }, [priceRange, visibleCandles]);

  /** Текущее окно как конкретные числа — с материализацией режима слежения. */
  const materializeView = useCallback((): View => {
    if (viewRef.current) return viewRef.current;
    const all = visibleCandles();
    const view = followView(all, stepRef.current || baseIntervalRef.current);
    viewRef.current = view;
    setFollowing(false);
    return view;
  }, [followView, visibleCandles]);

  const zoomBy = useCallback((factor: number) => {
    const v = materializeView();
    const tCenter = (v.t0 + v.t1) / 2;
    const tSpan = (v.t1 - v.t0) * factor;
    const pCenter = (v.y0 + v.y1) / 2;
    const pSpan = (v.y1 - v.y0) * factor;
    viewRef.current = clampView({
      t0: tCenter - tSpan / 2,
      t1: tCenter + tSpan / 2,
      y0: pCenter - pSpan / 2,
      y1: pCenter + pSpan / 2,
    });
    redrawRef.current();
  }, [clampView, materializeView]);

  const resetView = useCallback(() => {
    viewRef.current = null;
    setFollowing(true);
    redrawRef.current();
  }, []);

  // Эффект 1 — пересоздаёт функцию отрисовки и рисует немедленно на каждое
  // изменение данных (~4Hz тик игры). Слушатели событий сюда НЕ входят.
  useEffect(() => {
    candlesRef.current = candles;
    priceRef.current = currentPrice;
    symbolRef.current = symbol;
    tRef.current = t;
    colorsRef.current = candleColors;
    tfRef.current = tfFactor;
    baseIntervalRef.current = baseIntervalMs;

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

      // Своя раскладка вместо computePlotLayout(): слева только маленький
      // отступ, справа — место под подписи цены (их рисует drawPriceGrid).
      const layout: PlotLayout = { plotX: PAD_LEFT, plotW: Math.max(10, W - PAD_LEFT - PADR), plotH: H - PADB, W, H };
      layoutRef.current = layout;

      const allCandles = aggregateCandles(toChartCandles(candles), baseIntervalMs, tfFactor);
      if (allCandles.length < 2) {
        ctx.fillStyle = CHART_COLORS.axisTextWeak;
        ctx.font = "12px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText(tRef.current("game.chart.loading"), W / 2, H / 2);
        ctx.textAlign = "left";
        return;
      }

      const stepMs = allCandles[1].t - allCandles[0].t || baseIntervalMs * tfFactor;
      stepRef.current = stepMs;

      // В режиме слежения окно (и время, и цена) пересчитывается каждый кадр —
      // график едет за рынком. Как только пользователь его тронул, окно
      // фиксируется целиком, включая вертикальный масштаб: свечи перестают
      // «дышать» под каждую новую вершину, как на форексе.
      const view = viewRef.current ?? followView(allCandles, stepMs);
      const xspan = view.t1 - view.t0 || 1;
      const sx = (ms: number) => layout.plotX + ((ms - view.t0) / xspan) * layout.plotW;

      const yMin = view.y0;
      const yMax = view.y1;
      const yspan = yMax - yMin || 1;
      const sy = (p: number) => layout.plotH - ((p - yMin) / yspan) * layout.plotH;

      drawPriceGrid(ctx, layout, yMin, yMax, sy);

      // Своя (не drawTimeGrid) вертикальная сетка: ось X — игровое время
      // симуляции, а не календарные даты пользователя.
      ctx.strokeStyle = CHART_COLORS.gridWeak;
      ctx.fillStyle = CHART_COLORS.axisTextWeak;
      ctx.font = "10px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      const ticks = Math.max(3, Math.min(8, Math.floor(layout.plotW / 130)));
      for (let i = 0; i <= ticks; i++) {
        const ms = view.t0 + (xspan * i) / ticks;
        const x = sx(ms);
        if (x < layout.plotX - 1 || x > layout.plotX + layout.plotW + 1) continue;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, layout.plotH);
        ctx.stroke();
        ctx.fillText(fmtGameClock(ms), x, layout.H - 6);
      }
      ctx.textAlign = "left";

      // Свечи рисуем в отсечении по области графика: при ручном ценовом
      // масштабе часть баров уходит за верх/низ окна, и без clip они
      // рисовались бы поверх ценовой шкалы и подписей времени.
      ctx.save();
      ctx.beginPath();
      ctx.rect(layout.plotX, 0, layout.plotW, layout.plotH);
      ctx.clip();
      drawCandlesticks(ctx, allCandles, sx, sy, layout.plotX, layout.plotW, xspan, {
        bodyRatio: BODY_RATIO,
        up: colorsRef.current?.up,
        down: colorsRef.current?.down,
      });
      ctx.restore();

      const price = priceRef.current;
      if (price != null) drawLastPriceTag(ctx, price, sy(price), layout);

      ctx.font = "600 14px ui-sans-serif, system-ui";
      ctx.fillStyle = "rgba(230,233,240,0.72)";
      ctx.textAlign = "left";
      ctx.fillText(symbolRef.current, layout.plotX + 10, 20);

      // Crosshair + OHLC-подсказка под курсором — те же примитивы, что на
      // форексе/карте ордеров/карте ликвидаций.
      const hov = hoverRef.current;
      if (hov && hov.mx >= layout.plotX && hov.mx <= layout.plotX + layout.plotW && hov.my >= 0 && hov.my <= layout.plotH) {
        drawCrosshair(ctx, hov.mx, hov.my, layout);
        const priceH = yMin + (1 - hov.my / layout.plotH) * yspan;
        drawPriceCrosshairTag(ctx, priceH, hov.my, layout);
        const ms = view.t0 + ((hov.mx - layout.plotX) / layout.plotW) * xspan;
        const candle = allCandles.find((k) => ms >= k.t && ms < k.t + stepMs);
        drawTimeCrosshairTag(ctx, fmtGameClock(candle ? candle.t : ms), hov.mx, layout);
        if (candle) {
          drawTooltipBox(
            ctx,
            [
              `O ${fmtPriceLabel(candle.o)}  H ${fmtPriceLabel(candle.h)}`,
              `L ${fmtPriceLabel(candle.l)}  C ${fmtPriceLabel(candle.c)}`,
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
  }, [candles, currentPrice, symbol, t, candleColors, tfFactor, baseIntervalMs, followView]);

  // Эффект 2 — слушатели и ResizeObserver, ровно один раз.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ro = new ResizeObserver(() => redrawRef.current());
    ro.observe(container);

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      hoverRef.current = { mx, my };
      const drag = dragRef.current;
      const lay = layoutRef.current;
      if (drag && lay) {
        const span = drag.startView.t1 - drag.startView.t0;
        const dt = ((mx - drag.mx) / lay.plotW) * span;
        // Вертикаль тоже тянется — на форексе/ордерфлоу перетаскивание
        // двигает оба окна сразу, и мышечная память должна совпадать.
        const pspan = drag.startView.y1 - drag.startView.y0;
        const dp = ((my - drag.my) / lay.plotH) * pspan;
        viewRef.current = clampView({
          t0: drag.startView.t0 - dt,
          t1: drag.startView.t1 - dt,
          y0: drag.startView.y0 + dp,
          y1: drag.startView.y1 + dp,
        });
      }
      redrawRef.current();
    };
    const onDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      // Материализуем окно — в режиме слежения его ещё нет, и раньше именно
      // здесь панорама молча ничего не делала.
      dragRef.current = { mx: e.clientX - rect.left, my: e.clientY - rect.top, startView: { ...materializeView() } };
      canvas.style.cursor = "grabbing";
    };
    const onUp = () => {
      dragRef.current = null;
      canvas.style.cursor = "crosshair";
    };
    const onLeave = () => {
      hoverRef.current = null;
      dragRef.current = null;
      redrawRef.current();
    };
    const onDouble = () => {
      viewRef.current = null;
      setFollowing(true);
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
      // Зум держит под курсором ту же точку графика — и по времени, и по
      // цене, ровно как useChartInteractions на форексе/карте ордеров. Shift
      // сжимает только время (там та же клавиша).
      const fx = Math.min(1, Math.max(0, (mx - lay.plotX) / lay.plotW));
      const fy = Math.min(1, Math.max(0, my / lay.plotH));
      const tCursor = v.t0 + fx * (v.t1 - v.t0);
      const tSpan = (v.t1 - v.t0) * factor;
      let next: View = { ...v, t0: tCursor - fx * tSpan, t1: tCursor + (1 - fx) * tSpan };
      if (!e.shiftKey) {
        const pCursor = v.y1 - fy * (v.y1 - v.y0);
        const pSpan = (v.y1 - v.y0) * factor;
        next = { ...next, y1: pCursor + fy * pSpan, y0: pCursor - (1 - fy) * pSpan };
      }
      viewRef.current = clampView(next);
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

  const toolButton = "px-2 py-1 rounded-md text-xs font-medium text-muted hover:text-fg hover:bg-surface-2 transition";

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {TF_FACTORS.map((factor) => (
            <button
              key={factor}
              type="button"
              onClick={() => setTfFactor(factor)}
              title={t("game.chart.tfHint", { duration: fmtGameDuration(baseIntervalMs * factor) })}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                tfFactor === factor ? "bg-accent text-white" : "text-muted hover:text-fg"
              }`}
            >
              {fmtGameDuration(baseIntervalMs * factor)}
            </button>
          ))}
        </div>

        <span className="text-[11px] text-faint">{t("game.chart.tfLabel")}</span>

        <div className="ml-auto flex items-center gap-1">
          <button type="button" className={toolButton} onClick={() => zoomBy(1.4)} title={t("game.chart.zoomOut")}>
            <Minus size={14} />
          </button>
          <button type="button" className={toolButton} onClick={() => zoomBy(0.7)} title={t("game.chart.zoomIn")}>
            <Plus size={14} />
          </button>
          <button
            type="button"
            className={`${toolButton} inline-flex items-center gap-1 ${following ? "text-accent" : ""}`}
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
      </div>

      <div className="px-1 pt-1 text-[11px] text-faint">{t("game.chart.hint")}</div>
    </div>
  );
}
