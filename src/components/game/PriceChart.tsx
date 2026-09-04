"use client";

// Canvas-график цены — переиспользует примитивы src/lib/candlestickChart.ts
// (та же сетка/свечи/бирка цены, что у форекса/карты ордеров/карты
// ликвидаций), а НЕ TradingView lightweight-charts из спеки (ADJUSTED FROM
// SPEC, раздел 0 п.6 — обоснование в плане реализации): свой canvas-движок
// уже есть в проекте, третья ~45kb зависимость ради одного графика внутри
// MVP неоправданна.
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
  drawLastPriceTag,
  drawPriceGrid,
  type Candle as ChartCandle,
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

function toChartCandles(candles: EngineCandle[]): ChartCandle[] {
  return candles.map((c) => ({ t: c.timestamp, o: c.open, h: c.high, l: c.low, c: c.close }));
}

export default function PriceChart({
  candles,
  currentPrice,
  symbol,
}: {
  candles: EngineCandle[];
  currentPrice: number | undefined;
  symbol: string;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const draw = () => {
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
      const chartCandles = toChartCandles(candles);

      if (chartCandles.length < 2) {
        ctx.fillStyle = CHART_COLORS.axisTextWeak;
        ctx.font = "12px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText(t("game.chart.loading"), W / 2, H / 2);
        ctx.textAlign = "left";
        return;
      }

      const stepMs = chartCandles[1].t - chartCandles[0].t;
      const t0 = chartCandles[0].t;
      const t1 = chartCandles[chartCandles.length - 1].t + stepMs;
      const xspan = t1 - t0 || 1;
      const sx = (ms: number) => layout.plotX + ((ms - t0) / xspan) * layout.plotW;

      let yMin = Infinity;
      let yMax = -Infinity;
      for (const k of chartCandles) {
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
      const ticks = 4;
      for (let i = 0; i <= ticks; i++) {
        const ms = t0 + (xspan * i) / ticks;
        const x = sx(ms);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, layout.plotH);
        ctx.stroke();
        ctx.fillText(fmtGameClock(ms), x, layout.H - 6);
      }
      ctx.textAlign = "left";

      drawCandlesticks(ctx, chartCandles, sx, sy, layout.plotX, layout.plotW, xspan);

      if (currentPrice != null) {
        drawLastPriceTag(ctx, currentPrice, sy(currentPrice), layout);
      }

      // Символ — слева вверху, как на остальных графиках проекта.
      ctx.font = "600 14px ui-sans-serif, system-ui";
      ctx.fillStyle = "rgba(230,233,240,0.72)";
      ctx.textAlign = "left";
      ctx.fillText(symbol, layout.plotX + 10, 20);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [candles, currentPrice, symbol, t]);

  return (
    <div ref={containerRef} className="relative h-full w-full min-h-[280px]">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
