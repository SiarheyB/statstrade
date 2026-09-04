import { describe, it, expect } from "vitest";
import { ema, rsi, sma, type OhlcPoint } from "@/engine/market/indicators";

function series(closes: number[]): OhlcPoint[] {
  return closes.map((c, i) => ({ t: i * 60_000, o: c, h: c, l: c, c }));
}

describe("sma", () => {
  it("считает среднее за период и начинается с period-1 бара", () => {
    const out = sma(series([1, 2, 3, 4, 5]), 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ t: 2 * 60_000, value: 2 });
    expect(out[2].value).toBe(4);
  });

  it("на короткой истории молчит, а не выдумывает", () => {
    expect(sma(series([1, 2]), 5)).toEqual([]);
    expect(sma(series([1, 2, 3]), 0)).toEqual([]);
  });

  it("на плоском ряде равна самой цене", () => {
    const out = sma(series([100, 100, 100, 100]), 2);
    expect(out.every((p) => p.value === 100)).toBe(true);
  });
});

describe("ema", () => {
  it("заводится простой средней и дальше тянется за ценой", () => {
    const out = ema(series([10, 20, 30, 40]), 2);
    expect(out[0].value).toBe(15); // (10+20)/2
    // k = 2/3: 30*2/3 + 15*1/3 = 25
    expect(out[1].value).toBeCloseTo(25, 10);
  });

  it("реагирует на новый бар быстрее простой средней", () => {
    const closes = [10, 10, 10, 10, 10, 20];
    const fastEnd = ema(series(closes), 5).at(-1)!.value;
    const slowEnd = sma(series(closes), 5).at(-1)!.value;
    expect(fastEnd).toBeGreaterThan(slowEnd);
  });

  it("на короткой истории молчит", () => {
    expect(ema(series([1, 2]), 5)).toEqual([]);
  });
});

describe("rsi", () => {
  it("непрерывный рост даёт 100, непрерывное падение — 0", () => {
    const up = rsi(series(Array.from({ length: 30 }, (_, i) => 100 + i)), 14);
    const down = rsi(series(Array.from({ length: 30 }, (_, i) => 200 - i)), 14);
    expect(up.at(-1)!.value).toBe(100);
    expect(down.at(-1)!.value).toBeCloseTo(0, 6);
  });

  it("плоский рынок даёт нейтральные 50, а не деление на ноль", () => {
    const flat = rsi(series(Array.from({ length: 30 }, () => 100)), 14);
    expect(flat.at(-1)!.value).toBe(50);
  });

  it("всегда в границах 0..100", () => {
    const noisy = series(Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 3) * 5 + (i % 7)));
    for (const point of rsi(noisy, 14)) {
      expect(point.value).toBeGreaterThanOrEqual(0);
      expect(point.value).toBeLessThanOrEqual(100);
    }
  });

  it("на истории короче периода молчит", () => {
    expect(rsi(series([1, 2, 3]), 14)).toEqual([]);
  });
});
