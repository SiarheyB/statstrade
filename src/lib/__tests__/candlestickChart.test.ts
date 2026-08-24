import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computePlotLayout,
  fmtPriceLabel,
  fmtValLabel,
  niceStep,
  niceTimeStep,
  gridLineCount,
  fmtTimeHM,
  fmtDateDM,
  dayKey,
  drawPriceGrid,
  drawTimeGrid,
  drawCandlesticks,
  drawHistoryStartBoundary,
  drawCrosshair,
  drawLastPriceTag,
  drawPriceCrosshairTag,
  drawTimeCrosshairTag,
  drawTooltipBox,
  computeInitialView,
  buildTimeAxis,
  makeTimeProjection,
  LINEAR_TIME_AXIS,
  drawDeltaCvdChart,
  drawTwoLineSeries,
  CHART_COLORS,
  PADL,
  PADR,
  PADB,
  PRICE_AXIS_W,
  type Candle,
} from "@/lib/candlestickChart";

// jsdom's canvas getContext("2d") returns null (no canvas backend installed),
// so build a plain mock object covering every drawing method these helpers call.
function fakeCtx(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    setLineDash: vi.fn(),
    rotate: vi.fn(),
    translate: vi.fn(),
    setTransform: vi.fn(),
    arc: vi.fn(),
    drawImage: vi.fn(),
    createImageData: vi.fn(),
    getImageData: vi.fn(),
    putImageData: vi.fn(),
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

describe("pure helpers", () => {
  it("computePlotLayout computes plot area from paddings", () => {
    const layout = computePlotLayout(800, 400);
    expect(layout.plotX).toBe(PADL + PRICE_AXIS_W);
    expect(layout.plotW).toBe(800 - (PADL + PRICE_AXIS_W) - PADR);
    expect(layout.plotH).toBe(400 - PADB);
  });

  it("computePlotLayout respects custom padBottom", () => {
    const layout = computePlotLayout(800, 400, 0);
    expect(layout.plotH).toBe(400);
  });

  it("fmtPriceLabel formats by magnitude", () => {
    expect(fmtPriceLabel(12345)).toBe("12,345");
    expect(fmtPriceLabel(105.5)).toBe("105.50");
    expect(fmtPriceLabel(0.012345)).toBe("0.01235");
  });

  it("fmtValLabel formats by magnitude with suffixes", () => {
    expect(fmtValLabel(2_500_000_000)).toBe("2.50B");
    expect(fmtValLabel(2_500_000)).toBe("2.50M");
    expect(fmtValLabel(2_500)).toBe("2.50K");
    expect(fmtValLabel(500)).toBe("500");
  });

  it("niceStep returns 1 for non-finite or non-positive input", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
    expect(niceStep(NaN)).toBe(1);
    expect(niceStep(Infinity)).toBe(1);
  });

  it("niceStep rounds to a nice number", () => {
    expect(niceStep(1)).toBe(1);
    expect(niceStep(2.4)).toBe(2);
    expect(niceStep(4)).toBe(5);
    expect(niceStep(80)).toBe(100);
  });

  it("niceTimeStep picks the smallest step keeping lines under maxLines", () => {
    expect(niceTimeStep(8000, 8)).toBe(1000);
    expect(niceTimeStep(60000 * 100, 8)).toBeGreaterThanOrEqual(60000);
  });

  it("niceTimeStep falls back to the largest step for huge spans", () => {
    expect(niceTimeStep(Number.MAX_SAFE_INTEGER, 1)).toBe(30 * 86400000);
  });

  it("fmtTimeHM and fmtDateDM format zero-padded time/date", () => {
    const ms = Date.UTC(2026, 7, 3, 5, 7); // Aug 3 2026 05:07 UTC
    expect(fmtTimeHM(ms, "UTC")).toBe("05:07");
    expect(fmtDateDM(ms, "UTC")).toBe("03.08");
  });

  it("dayKey encodes y/mo/d into a sortable number", () => {
    const ms = Date.UTC(2026, 7, 3, 12, 0);
    expect(dayKey(ms, "UTC")).toBe(20260703);
  });

  it("computeInitialView pads vertical range and returns full time range from window", () => {
    const candles: Candle[] = [
      { t: 0, o: 1, h: 2, l: 0.5, c: 1.5 },
      { t: 60000, o: 1.5, h: 3, l: 1, c: 2 },
    ];
    const view = computeInitialView(candles, 0, 120000, 40);
    expect(view.t1).toBe(120000);
    expect(view.y0).toBeLessThan(0.5);
    expect(view.y1).toBeGreaterThan(3);
  });

  it("computeInitialView falls back to full candle range when window is empty", () => {
    const candles: Candle[] = [{ t: 1_000_000, o: 1, h: 2, l: 0.5, c: 1.5 }];
    const view = computeInitialView(candles, 0, 10, 40);
    expect(Number.isFinite(view.y0)).toBe(true);
    expect(Number.isFinite(view.y1)).toBe(true);
  });
});

// Сжатие неторговых промежутков: без него график форекса рвётся пустыми
// полосами на каждых выходных (см. TimeAxis в candlestickChart.ts).
describe("buildTimeAxis", () => {
  const H = 3_600_000;
  // Пн-Пт по часу, потом «выходные» (пропуск 48 часов), потом снова часы.
  const withWeekendGap = (): Candle[] => {
    const out: Candle[] = [];
    for (let i = 0; i < 5; i++) out.push({ t: i * H, o: 1, h: 2, l: 0, c: 1 });
    for (let i = 0; i < 5; i++) out.push({ t: 5 * H + 48 * H + i * H, o: 1, h: 2, l: 0, c: 1 });
    return out;
  };

  it("оставляет ось линейной, когда пропусков нет", () => {
    const candles: Candle[] = [0, H, 2 * H, 3 * H].map((t) => ({ t, o: 1, h: 2, l: 0, c: 1 }));
    const axis = buildTimeAxis(candles, H);
    expect(axis).toBe(LINEAR_TIME_AXIS);
  });

  it("вырезает промежуток без свечей", () => {
    const axis = buildTimeAxis(withWeekendGap(), H);
    const beforeGap = 4 * H;   // последняя свеча пятницы
    const afterGap = 53 * H;   // первая свеча понедельника
    // В реальном времени между ними 49 часов, в торговом — один шаг.
    expect(afterGap - beforeGap).toBe(49 * H);
    expect(axis.compress(afterGap) - axis.compress(beforeGap)).toBe(H);
  });

  it("не трогает время до первого пропуска", () => {
    const axis = buildTimeAxis(withWeekendGap(), H);
    expect(axis.compress(2 * H)).toBe(2 * H);
  });

  it("схлопывает точку внутри пропуска на его начало", () => {
    const axis = buildTimeAxis(withWeekendGap(), H);
    const gapStart = 5 * H;
    const middleOfGap = 20 * H;
    expect(axis.compress(middleOfGap)).toBe(axis.compress(gapStart));
  });

  it("expand возвращает исходное время для точек вне пропусков", () => {
    const axis = buildTimeAxis(withWeekendGap(), H);
    for (const t of [0, 2 * H, 4 * H, 53 * H, 57 * H]) {
      expect(axis.expand(axis.compress(t))).toBe(t);
    }
  });

  it("схлопывает даже одну пропущенную свечу", () => {
    // На форексе пропуск свечи = не было ни одного тика (обычное дело ночью),
    // а не потеря данных — держать под него пустое место незачем.
    const candles: Candle[] = [0, H, 3 * H, 4 * H].map((t) => ({ t, o: 1, h: 2, l: 0, c: 1 }));
    const axis = buildTimeAxis(candles, H);
    expect(axis.compress(3 * H) - axis.compress(H)).toBe(H);
  });

  it("справляется с несколькими пропусками подряд", () => {
    const candles: Candle[] = [0, H, 50 * H, 51 * H, 100 * H, 101 * H]
      .map((t) => ({ t, o: 1, h: 2, l: 0, c: 1 }));
    const axis = buildTimeAxis(candles, H);
    // Реально 101 час, в торговом времени — 5 шагов между шестью свечами.
    expect(axis.compress(101 * H) - axis.compress(0)).toBe(5 * H);
    expect(axis.expand(axis.compress(100 * H))).toBe(100 * H);
  });
});

describe("makeTimeProjection", () => {
  const H = 3_600_000;
  const candles: Candle[] = [0, H, 2 * H, 50 * H, 51 * H].map((t) => ({ t, o: 1, h: 2, l: 0, c: 1 }));

  it("растягивает окно на всю ширину области графика", () => {
    const axis = buildTimeAxis(candles, H);
    const { sx } = makeTimeProjection(axis, 0, 51 * H, 100, 400);
    expect(sx(0)).toBe(100);
    expect(sx(51 * H)).toBeCloseTo(500, 6);
  });

  it("свечи по краям пропуска стоят на соседних позициях", () => {
    const axis = buildTimeAxis(candles, H);
    const { sx } = makeTimeProjection(axis, 0, 51 * H, 0, 400);
    // Четыре шага торгового времени на 400px — по 100px на шаг, включая стык
    // «до выходных / после выходных».
    expect(sx(2 * H)).toBeCloseTo(200, 6);
    expect(sx(50 * H)).toBeCloseTo(300, 6);
  });

  it("invX обратна sx", () => {
    const axis = buildTimeAxis(candles, H);
    const { sx, invX } = makeTimeProjection(axis, 0, 51 * H, 40, 400);
    for (const t of [0, H, 2 * H, 50 * H, 51 * H]) {
      expect(invX(sx(t))).toBe(t);
    }
  });

  it("на линейной оси ведёт себя как раньше", () => {
    const { sx } = makeTimeProjection(LINEAR_TIME_AXIS, 0, 1000, 0, 100);
    expect(sx(500)).toBeCloseTo(50, 6);
  });
});

describe("canvas drawing functions", () => {
  let ctx: CanvasRenderingContext2D;
  beforeEach(() => {
    ctx = fakeCtx();
  });

  it("сетка гуще на большом полотне и реже на узком", () => {
    // Плотность привязана к пикселям: на фуллскрине линий должно быть заметно
    // больше, на телефоне — не больше прежнего, иначе подписи слипаются.
    const lines = (w: number, h: number) => {
      const layout = computePlotLayout(w, h);
      const strokes = () => (ctx.stroke as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
      (ctx.stroke as unknown as { mockClear: () => void }).mockClear();
      drawPriceGrid(ctx, layout, 4640, 4690, (p) => layout.plotH - ((p - 4640) / 50) * layout.plotH);
      const price = strokes();
      (ctx.stroke as unknown as { mockClear: () => void }).mockClear();
      const t0 = Date.UTC(2026, 7, 24, 16, 0);
      const t1 = t0 + 2.2 * 3600_000;
      drawTimeGrid(ctx, layout, t0, t1, "UTC", (ms) => layout.plotX + ((ms - t0) / (t1 - t0)) * layout.plotW);
      return { price, time: strokes() };
    };

    const wide = lines(1000, 620);   // график на весь экран
    const narrow = lines(375, 480);  // телефон

    expect(wide.price).toBeGreaterThanOrEqual(9);  // было 5 при фиксированных 6 линиях
    expect(wide.time).toBeGreaterThanOrEqual(8);   // было 4 (шаг 30 минут)
    expect(narrow.time).toBeLessThanOrEqual(wide.time);
  });

  it("gridLineCount ограничен снизу и сверху и не боится мусора", () => {
    expect(gridLineCount(1000, 100, 3, 20)).toBe(10);
    expect(gridLineCount(50, 100, 3, 20)).toBe(3);      // пол
    expect(gridLineCount(100000, 100, 3, 20)).toBe(20); // потолок
    expect(gridLineCount(NaN, 100, 3, 20)).toBe(3);
    expect(gridLineCount(0, 100, 3, 20)).toBe(3);
  });

  it("drawPriceGrid draws gridlines and labels within plot bounds", () => {
    const layout = computePlotLayout(800, 400);
    drawPriceGrid(ctx, layout, 0, 100, (p) => layout.plotH - p * 3);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it("drawTimeGrid draws vertical lines and day/time labels", () => {
    const layout = computePlotLayout(800, 400);
    const t0 = Date.UTC(2026, 7, 3, 0, 0);
    const t1 = t0 + 3600000 * 6;
    drawTimeGrid(ctx, layout, t0, t1, "UTC", (ms) => layout.plotX + ((ms - t0) / (t1 - t0)) * layout.plotW);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it("drawCandlesticks does nothing for fewer than 2 candles", () => {
    drawCandlesticks(ctx, [{ t: 0, o: 1, h: 2, l: 0.5, c: 1.5 }], (t) => t, (p) => p, 0, 100, 100);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("drawCandlesticks draws a bullish (up) candle in up color", () => {
    const candles: Candle[] = [
      { t: 0, o: 1, h: 2, l: 0.5, c: 1.8 },
      { t: 60000, o: 1.8, h: 2.5, l: 1.5, c: 2.2 },
    ];
    const sx = (ms: number) => 100 + ms / 1000;
    const sy = (p: number) => 400 - p * 100;
    drawCandlesticks(ctx, candles, sx, sy, 0, 800, 120000);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.strokeStyle).toBe(CHART_COLORS.up);
  });

  it("drawCandlesticks draws a bearish (down) candle in down color", () => {
    const candles: Candle[] = [
      { t: 0, o: 2, h: 2.2, l: 1, c: 1.2 },
      { t: 60000, o: 1.2, h: 1.5, l: 0.8, c: 1.0 },
    ];
    const sx = (ms: number) => 100 + ms / 1000;
    const sy = (p: number) => 400 - p * 100;
    drawCandlesticks(ctx, candles, sx, sy, 0, 800, 120000);
    expect(ctx.strokeStyle).toBe(CHART_COLORS.down);
  });

  it("drawCandlesticks treats doji (c===o) as bullish (up>=), draws min-height body", () => {
    const candles: Candle[] = [
      { t: 0, o: 1.5, h: 2, l: 1, c: 1.5 },
      { t: 60000, o: 1.5, h: 2, l: 1, c: 1.5 },
    ];
    const sx = (ms: number) => 100 + ms / 1000;
    const sy = (p: number) => 400 - p * 100;
    drawCandlesticks(ctx, candles, sx, sy, 0, 800, 120000);
    expect(ctx.strokeStyle).toBe(CHART_COLORS.up);
    const fillRectCall = (ctx.fillRect as any).mock.calls[0];
    expect(fillRectCall[3]).toBeGreaterThanOrEqual(1); // min height 1
  });

  it("drawCandlesticks supports clusters mode with custom colW", () => {
    const candles: Candle[] = [
      { t: 0, o: 1, h: 2, l: 0.5, c: 1.8 },
      { t: 60000, o: 1.8, h: 2.5, l: 1.5, c: 2.2 },
    ];
    const sx = (ms: number) => 100 + ms / 1000;
    const sy = (p: number) => 400 - p * 100;
    drawCandlesticks(ctx, candles, sx, sy, 0, 800, 120000, { clusters: true, colW: 5 });
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it("drawHistoryStartBoundary skips when x is outside plot area", () => {
    const layout = computePlotLayout(800, 400);
    drawHistoryStartBoundary(ctx, -100, layout, "history start");
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it("drawHistoryStartBoundary draws dashed line and rotated label inside plot area", () => {
    const layout = computePlotLayout(800, 400);
    drawHistoryStartBoundary(ctx, layout.plotX + 10, layout, "history start");
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
    expect(ctx.rotate).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("history start", 0, 0);
  });

  it("drawCrosshair draws dashed cross lines", () => {
    const layout = computePlotLayout(800, 400);
    drawCrosshair(ctx, 200, 100, layout);
    expect(ctx.setLineDash).toHaveBeenCalledWith([3, 3]);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("drawLastPriceTag skips when yp is outside plot bounds", () => {
    const layout = computePlotLayout(800, 400);
    drawLastPriceTag(ctx, 100, -10, layout);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("drawLastPriceTag draws price tag when yp within bounds", () => {
    const layout = computePlotLayout(800, 400);
    drawLastPriceTag(ctx, 100, 50, layout);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("100.00", expect.any(Number), expect.any(Number));
  });

  it("drawPriceCrosshairTag draws the price tag box", () => {
    const layout = computePlotLayout(800, 400);
    drawPriceCrosshairTag(ctx, 50.5, 30, layout);
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it("drawTimeCrosshairTag draws a centered time tag box", () => {
    const layout = computePlotLayout(800, 400);
    drawTimeCrosshairTag(ctx, "12:00", 300, layout);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("12:00", expect.any(Number), expect.any(Number));
  });

  it("drawTooltipBox draws multi-line tooltip and flips position near edges", () => {
    const layout = computePlotLayout(800, 400);
    drawTooltipBox(ctx, ["line1", "line2"], layout.plotX + layout.plotW - 5, layout.plotH - 5, layout);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.strokeRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
  });

  it("drawDeltaCvdChart shows empty text when delta is empty", () => {
    drawDeltaCvdChart(ctx, {
      W: 800, H: 200, t0: 0, t1: 1000, times: [], delta: [], emptyText: "no data",
    });
    expect(ctx.fillText).toHaveBeenCalledWith("no data", expect.any(Number), 100);
  });

  it("drawDeltaCvdChart draws bars and cvd line when data present", () => {
    drawDeltaCvdChart(ctx, {
      W: 800, H: 200, t0: 0, t1: 4,
      times: [0, 1, 2, 3],
      delta: [5, -3, 0, 8],
      cvd: [5, 2, 2, 10],
      emptyText: "no data",
    });
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("drawDeltaCvdChart skips cvd line when lengths mismatch", () => {
    drawDeltaCvdChart(ctx, {
      W: 800, H: 200, t0: 0, t1: 4,
      times: [0, 1, 2],
      delta: [5, -3, 2],
      cvd: [1, 2],
      emptyText: "no data",
    });
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it("drawTwoLineSeries shows empty text when series a is empty", () => {
    drawTwoLineSeries(ctx, {
      W: 800, H: 200, t0: 0, t1: 100, times: [], a: [], b: [],
      colorA: "red", colorB: "blue", labelA: "A", labelB: "B", title: "T", emptyText: "empty",
    });
    expect(ctx.fillText).toHaveBeenCalledWith("empty", expect.any(Number), 100);
  });

  it("drawTwoLineSeries draws both lines, band fill, and legend", () => {
    drawTwoLineSeries(ctx, {
      W: 800, H: 200, t0: 0, t1: 3,
      times: [0, 1, 2, 3],
      a: [1, 2, 3, 2],
      b: [0.5, 1, 2, 1],
      colorA: "red", colorB: "blue", labelA: "Bid", labelB: "Ask", title: "B/A",
      emptyText: "empty", fillBand: true,
    });
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("B/A", expect.any(Number), 12);
    expect(ctx.fillText).toHaveBeenCalledWith("Bid", expect.any(Number), 12);
    expect(ctx.fillText).toHaveBeenCalledWith("Ask", expect.any(Number), 24);
  });

  it("drawTwoLineSeries respects an explicit yDomain", () => {
    drawTwoLineSeries(ctx, {
      W: 800, H: 200, t0: 0, t1: 3,
      times: [0, 1, 2, 3],
      a: [1, 2, 3, 2],
      b: [0.5, 1, 2, 1],
      colorA: "red", colorB: "blue", labelA: "Bid", labelB: "Ask", title: "B/A",
      emptyText: "empty", yDomain: [0, 10],
    });
    expect(ctx.stroke).toHaveBeenCalled();
  });
});
