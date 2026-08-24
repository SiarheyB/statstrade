import { describe, it, expect, vi } from "vitest";
import { drawSessionBoxes } from "@/lib/sessionOverlay";
import type { Candle, PlotLayout } from "@/lib/candlestickChart";
import type { SessionWindow } from "@/lib/tradingSessions";

function makeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    measureText: (t: string) => ({ width: t.length * 6 }),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
}

const layout: PlotLayout = { plotX: 0, plotW: 400, plotH: 200, W: 464, H: 220 };
const START = 1_000_000;
const END = START + 100;
// x = время, y = 200 - цена: удобно проверять координаты глазами
const sx = (ms: number) => ms - START;
const sy = (p: number) => 200 - p;

const win = (over: Partial<SessionWindow> = {}): SessionWindow => ({
  id: "london", label: "London", color: "#f59e0b", start: START, end: END, ...over,
});

const candle = (t: number, l: number, h: number): Candle => ({ t, o: l, h, l, c: h });

describe("drawSessionBoxes", () => {
  it("рисует коробку по хай/лоу свечей сессии и подписывает её", () => {
    const ctx = makeCtx();
    const candles = [candle(START + 10, 50, 120), candle(START + 50, 40, 90), candle(END + 10, 5, 190)];
    drawSessionBoxes(ctx, [win()], candles, sx, sy, layout);

    // хай 120 → y=80, лоу 40 → y=160, плюс по 3px воздуха; правый край — по
    // последней свече сессии (START+50) плюс шаг свечи (40)
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 77, 90, 86);
    expect(ctx.strokeRect).toHaveBeenCalled();
    // подпись по центру коробки (0..90 → 45)
    expect(ctx.fillText).toHaveBeenCalledWith("London", 45, expect.any(Number));
  });

  it("свечи вне окна сессии на коробку не влияют", () => {
    const ctx = makeCtx();
    // свеча за окном имеет экстремальные хай/лоу — они не должны попасть в коробку
    const candles = [candle(START + 10, 50, 120), candle(END + 5, 0, 200)];
    drawSessionBoxes(ctx, [win()], candles, sx, sy, layout);
    // коробка построена только по свече внутри окна: хай 120 → 80-3, лоу 50 → 150+3
    const [, y, , h] = (ctx.fillRect as unknown as { mock: { calls: number[][] } }).mock.calls[0];
    expect([y, h]).toEqual([77, 76]);
  });

  it("сессия без свечей не рисуется", () => {
    const ctx = makeCtx();
    drawSessionBoxes(ctx, [win()], [candle(END + 10, 10, 20)], sx, sy, layout);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("узкую коробку рисует, но без подписи", () => {
    const ctx = makeCtx();
    const narrow = win({ end: START + 10 }); // 10px
    drawSessionBoxes(ctx, [narrow], [candle(START + 5, 50, 120)], sx, sy, layout);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("обрезает коробку по краям графика", () => {
    const ctx = makeCtx();
    const wide = win({ start: START - 500, end: END + 500 });
    drawSessionBoxes(ctx, [wide], [candle(START + 10, 50, 120)], sx, sy, layout);
    const [x, , w] = (ctx.fillRect as unknown as { mock: { calls: number[][] } }).mock.calls[0];
    expect(x).toBe(layout.plotX);
    expect(w).toBe(layout.plotW);
  });

  it("сессия целиком за экраном не рисуется", () => {
    const ctx = makeCtx();
    const off = win({ start: START + 10_000, end: START + 20_000 });
    drawSessionBoxes(ctx, [off], [candle(START + 15_000, 50, 120)], sx, sy, layout);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("идущая сессия не тянется в будущее — коробка заканчивается на последней свече", () => {
    const ctx = makeCtx();
    // сессия ещё идёт: свечи есть только на первой трети окна
    const candles = [candle(START + 5, 50, 120), candle(START + 15, 60, 110)];
    drawSessionBoxes(ctx, [win()], candles, sx, sy, layout);
    const [, , w] = (ctx.fillRect as unknown as { mock: { calls: number[][] } }).mock.calls[0];
    expect(w).toBe(25); // последняя свеча (15) + шаг (10)
  });

  it("подписи пересекающихся сессий разъезжаются по вертикали", () => {
    const ctx = makeCtx();
    // две сессии с одинаковым диапазоном и почти одинаковым окном — подписи
    // легли бы одна на другую
    const a = win({ id: "london", label: "London" });
    const b = win({ id: "newYork", label: "New York", color: "#10b981", start: START + 5, end: END + 5 });
    const candles = [candle(START + 10, 50, 120), candle(START + 60, 50, 120)];
    drawSessionBoxes(ctx, [a, b], candles, sx, sy, layout);
    const ys = (ctx.fillText as unknown as { mock: { calls: [string, number, number][] } }).mock.calls.map((c) => c[2]);
    expect(ys).toHaveLength(2);
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThanOrEqual(12);
  });

  it("ничего не делает без окон или без свечей", () => {
    const ctx = makeCtx();
    drawSessionBoxes(ctx, [], [candle(START, 1, 2)], sx, sy, layout);
    drawSessionBoxes(ctx, [win()], [], sx, sy, layout);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.save).not.toHaveBeenCalled();
  });
});
