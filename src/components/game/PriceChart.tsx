"use client";

// Canvas-график цены — переиспользует примитивы src/lib/candlestickChart.ts
// (та же сетка/свечи/бирка цены/crosshair-подсказка, что у форекса/карты
// ордеров/карты ликвидаций), а НЕ TradingView lightweight-charts из спеки
// (ADJUSTED FROM SPEC, раздел 0 п.6) — свой canvas-движок уже есть в
// проекте, третья ~45kb зависимость ради одного графика неоправданна.
//
// Пан/зум — свой, лёгкий (t0/t1 в ref, без React state — иначе перерисовка
// на каждый pointermove просаживала бы кадр), а НЕ общий
// lib/useChartInteractions.ts: тот хук неразрывно завязан на инструменты
// рисования (DrawingRow/saveDrawing/updateDrawing и т.д.), которых у
// графика игры нет и не планируется — тащить их сюда как обязательные
// пропсы ради одного лишь зума было бы накладнее, чем написать прицельно
// под то, что реально нужно: колесо = зум, драг = пан, движение мыши =
// crosshair + OHLC-подсказка, двойной клик = сброс вида.
//
// Слушатели мыши/колеса навешаны ОДИН раз (эффект без зависимостей) и сами
// не перевешиваются на каждый тик игры (~4Hz) — иначе драг прерывался бы
// снятием/пересозданием листенеров посреди перетаскивания. Сама функция
// перерисовки лежит в redrawRef и обновляется отдельным эффектом на
// изменение данных; листенеры всегда зовут redrawRef.current(), поэтому
// не ловят устаревшее замыкание.
//
// drawTimeGrid из candlestickChart.ts НЕ используется: она форматирует метки
// как реальные календарные даты через таймзону пользователя, а ось X здесь —
// игровое время симуляции (миллисекунды с начала партии, не unix-время).
// Часовая сетка ниже — свой лёгкий форматтер "День X, HH:MM".
import { useEffect, useRef } from "react";
import {
  CHART_COLORS,
  computePlotLayout,
  drawCandlesticks,
  drawCrosshair,
  drawLastPriceTag,
  drawPriceCrosshairTag,
  drawPriceGrid,
  drawTimeCrosshairTag,
  drawTooltipBox,
  fmtPriceLabel,
  type Candle as ChartCandle,
  type PlotLayout,
} from "@/lib/candlestickChart";
import type { Candle as EngineCandle } from "@/engine/entities/types";
import { useI18n } from "@/lib/i18n/provider";

function fmtGameClock(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const day = Math.floor(totalMinutes / (24 * 60)) + 1;
  const hh = String(Math.floor((totalMinutes % (24 * 60)) / 60)).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `Д${day} ${hh}:${mm}`;
}

// Сортируем защитно: t0/t1 ниже и drawCandlesticks() в lib/candlestickChart.ts
// оба предполагают строго возрастающий порядок по времени и молча рисуют
// мусор, если это не так (см. фикс в gameStore.ts/gameLoop.ts — данные
// теперь и на входе должны быть отсортированы, это вторая линия обороны).
function toChartCandles(candles: EngineCandle[]): ChartCandle[] {
  return [...candles]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((c) => ({ t: c.timestamp, o: c.open, h: c.high, l: c.low, c: c.close }));
}

type View = { t0: number; t1: number };

const ZOOM_IN_LIMIT_CANDLES = 5; // не даём зумить ближе, чем 5 свечей в окне
const ZOOM_OUT_LIMIT = 3; // не дальше, чем 3x вся загруженная история

export default function PriceChart({
  candles,
  currentPrice,
  symbol,
  candleColors,
}: {
  candles: EngineCandle[];
  currentPrice: number | undefined;
  symbol: string;
  // Цвета свечей купленной в магазине темы (раздел 13). undefined — цвета
  // по умолчанию, те же, что у форекса/карты ордеров.
  candleColors?: { up: string; down: string };
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const candlesRef = useRef(candles);
  const priceRef = useRef(currentPrice);
  const symbolRef = useRef(symbol);
  const tRef = useRef(t);
  // Через ref, а не напрямую в замыкании: слушатели мыши навешаны один раз и
  // зовут redrawRef.current(), поэтому цвет темы должен читаться в момент
  // отрисовки, а не остаться в замыкании первого рендера.
  const colorsRef = useRef(candleColors);

  const viewRef = useRef<View | null>(null); // null = автоподгон под всю историю
  const layoutRef = useRef<PlotLayout | null>(null);
  const hoverRef = useRef<{ mx: number; my: number } | null>(null);
  const dragRef = useRef<{ mx: number; startView: View } | null>(null);
  const redrawRef = useRef<() => void>(() => {});

  const clampView = (v: View): View => {
    const all = toChartCandles(candlesRef.current);
    if (all.length < 2) return v;
    const stepMs = all[1].t - all[0].t;
    const fullT0 = all[0].t;
    const fullT1 = all[all.length - 1].t + stepMs;
    const fullSpan = fullT1 - fullT0 || stepMs;
    const minSpan = stepMs * ZOOM_IN_LIMIT_CANDLES;
    const maxSpan = fullSpan * ZOOM_OUT_LIMIT;
    const span = Math.min(maxSpan, Math.max(minSpan, v.t1 - v.t0));
    let t0 = v.t0;
    let t1 = t0 + span;
    // Не уезжаем панорамой дальше истории больше, чем на один экран влево/вправо.
    if (t0 < fullT0 - span) {
      t0 = fullT0 - span;
      t1 = t0 + span;
    }
    if (t1 > fullT1 + span) {
      t1 = fullT1 + span;
      t0 = t1 - span;
    }
    return { t0, t1 };
  };

  // Эффект 1 — пересоздаёт функцию отрисовки и рисует немедленно на каждое
  // изменение данных (~4Hz тик игры). Слушатели событий сюда НЕ входят.
  useEffect(() => {
    candlesRef.current = candles;
    priceRef.current = currentPrice;
    symbolRef.current = symbol;
    tRef.current = t;
    colorsRef.current = candleColors;

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

      const layout = computePlotLayout(W, H);
      layoutRef.current = layout;
      const allCandles = toChartCandles(candlesRef.current);

      if (allCandles.length < 2) {
        ctx.fillStyle = CHART_COLORS.axisTextWeak;
        ctx.font = "12px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText(tRef.current("game.chart.loading"), W / 2, H / 2);
        ctx.textAlign = "left";
        return;
      }

      const stepMs = allCandles[1].t - allCandles[0].t;
      const fullT0 = allCandles[0].t;
      const fullT1 = allCandles[allCandles.length - 1].t + stepMs;

      if (!viewRef.current) viewRef.current = { t0: fullT0, t1: fullT1 };
      const view = viewRef.current;
      const xspan = view.t1 - view.t0 || 1;
      const sx = (ms: number) => layout.plotX + ((ms - view.t0) / xspan) * layout.plotW;

      const visible = allCandles.filter((k) => k.t + stepMs >= view.t0 && k.t <= view.t1);
      const forRange = visible.length > 0 ? visible : allCandles;
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const k of forRange) {
        yMin = Math.min(yMin, k.l);
        yMax = Math.max(yMax, k.h);
      }
      const pad = (yMax - yMin) * 0.08 || yMax * 0.01 || 1;
      yMin -= pad;
      yMax += pad;
      const yspan = yMax - yMin || 1;
      const sy = (p: number) => layout.plotH - ((p - yMin) / yspan) * layout.plotH;

      drawPriceGrid(ctx, layout, yMin, yMax, sy);

      // Своя (не drawTimeGrid) вертикальная сетка — игровые часы/дни, не даты.
      ctx.strokeStyle = CHART_COLORS.gridWeak;
      ctx.fillStyle = CHART_COLORS.axisTextWeak;
      ctx.font = "10px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      const ticks = 5;
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

      drawCandlesticks(ctx, allCandles, sx, sy, layout.plotX, layout.plotW, xspan, {
        up: colorsRef.current?.up,
        down: colorsRef.current?.down,
      });

      const price = priceRef.current;
      if (price != null) {
        drawLastPriceTag(ctx, price, sy(price), layout);
      }

      // Символ — слева вверху, как на остальных графиках проекта.
      ctx.font = "600 14px ui-sans-serif, system-ui";
      ctx.fillStyle = "rgba(230,233,240,0.72)";
      ctx.textAlign = "left";
      ctx.fillText(symbolRef.current, layout.plotX + 10, 20);

      // Crosshair + OHLC-подсказка под курсором — как на форексе/карте
      // ордеров/карте ликвидаций (переиспользует те же примитивы).
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
            [`O ${fmtPriceLabel(candle.o)}  H ${fmtPriceLabel(candle.h)}`, `L ${fmtPriceLabel(candle.l)}  C ${fmtPriceLabel(candle.c)}`],
            hov.mx,
            hov.my,
            layout,
          );
        }
      }
    };

    redrawRef.current = draw;
    draw();
  }, [candles, currentPrice, symbol, t, candleColors]);

  // Эффект 2 — вешает слушатели событий и ResizeObserver ОДИН раз (пустые
  // зависимости), не пересоздаёт их на каждый тик игры.
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
        viewRef.current = clampView({ t0: drag.startView.t0 - dt, t1: drag.startView.t1 - dt });
      }
      redrawRef.current();
    };
    const onDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      if (!viewRef.current) return;
      dragRef.current = { mx, startView: { ...viewRef.current } };
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
      viewRef.current = null; // сброс — снова автоподгон под всю историю
      redrawRef.current();
    };
    const onWheel = (e: WheelEvent) => {
      const lay = layoutRef.current;
      if (!viewRef.current || !lay) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const v = viewRef.current;
      const span = v.t1 - v.t0;
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      const fx = Math.min(1, Math.max(0, (mx - lay.plotX) / lay.plotW));
      const tCursor = v.t0 + fx * span;
      const newSpan = span * factor;
      viewRef.current = clampView({ t0: tCursor - fx * newSpan, t1: tCursor + (1 - fx) * newSpan });
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
  }, []);

  return (
    <div ref={containerRef} className="relative h-full w-full min-h-[280px]">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
