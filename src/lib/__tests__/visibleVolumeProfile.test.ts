import { describe, it, expect } from "vitest";
import { profileFromCandles, profileFromFootprint } from "@/lib/visibleVolumeProfile";
import type { FootprintCandle } from "@/lib/orderflow";

const bar = (t: number, l: number, h: number, v: number) => ({ t, l, h, v });

describe("profileFromCandles", () => {
  it("возвращает null, когда в окне нет свечей", () => {
    expect(profileFromCandles([bar(100, 1, 2, 5)], 200, 300)).toBeNull();
  });

  it("берёт только свечи внутри видимого окна", () => {
    // Свеча вне окна стоит в другом ценовом диапазоне — если она попадёт в
    // расчёт, сместится и POC, и границы профиля.
    const profile = profileFromCandles(
      [bar(100, 10, 11, 100), bar(500, 50, 51, 100)],
      400,
      600,
    )!;
    expect(profile.poc).toBeGreaterThanOrEqual(50);
    expect(profile.poc).toBeLessThanOrEqual(51);
  });

  it("ставит POC туда, где прошло больше всего объёма", () => {
    const profile = profileFromCandles(
      [bar(1, 100, 101, 1), bar(2, 104, 105, 50), bar(3, 108, 109, 1)],
      0,
      10,
    )!;
    expect(profile.poc).toBeGreaterThan(103);
    expect(profile.poc).toBeLessThan(106);
    expect(profile.levels.some((l) => l.isPoc)).toBe(true);
  });

  it("размазывает объём свечи по её диапазону high–low", () => {
    // Одна широкая свеча: объём должен разойтись по многим уровням, а не
    // сесть в один — иначе профиль по OHLCV вырождается в набор точек.
    const profile = profileFromCandles([bar(1, 100, 200, 60)], 0, 10)!;
    const withVolume = profile.levels.filter((l) => l.volume > 0);
    expect(withVolume.length).toBeGreaterThan(10);
    const total = profile.levels.reduce((s, l) => s + l.volume, 0);
    expect(total).toBeCloseTo(60, 6);
  });

  it("value area покрывает ~70% объёма и лежит вокруг POC", () => {
    const bars = [
      bar(1, 100, 100.5, 1), bar(2, 102, 102.5, 1),
      bar(3, 105, 105.5, 90),
      bar(4, 108, 108.5, 1), bar(5, 110, 110.5, 1),
    ];
    const profile = profileFromCandles(bars, 0, 10)!;
    expect(profile.valueAreaVolume / profile.totalVolume).toBeGreaterThanOrEqual(0.7);
    expect(profile.val).toBeLessThanOrEqual(profile.poc);
    expect(profile.vah).toBeGreaterThanOrEqual(profile.poc);
    expect(profile.valueAreaPct).toBe(0.7);
  });

  it("не делит на ноль на плоском участке", () => {
    const profile = profileFromCandles([bar(1, 100, 100, 5), bar(2, 100, 100, 5)], 0, 10)!;
    expect(profile.poc).toBeCloseTo(100, 6);
    expect(profile.levels).toHaveLength(1);
    expect(Number.isFinite(profile.binSize)).toBe(true);
  });

  it("игнорирует свечи с нулевым объёмом", () => {
    expect(profileFromCandles([bar(1, 10, 11, 0)], 0, 10)).toBeNull();
  });

  it("pct считается от объёма POC", () => {
    const profile = profileFromCandles([bar(1, 100, 100.5, 10), bar(2, 110, 110.5, 5)], 0, 10)!;
    const poc = profile.levels.find((l) => l.isPoc)!;
    expect(poc.pct).toBeCloseTo(100, 6);
  });
});

describe("profileFromFootprint", () => {
  const fp = (t: number, levels: { price: number; buy: number; sell: number }[]): FootprintCandle => ({ t, levels });

  it("суммирует buy и sell по каждой цене", () => {
    const profile = profileFromFootprint(
      [fp(1, [{ price: 100, buy: 3, sell: 2 }]), fp(2, [{ price: 100, buy: 1, sell: 4 }])],
      0,
      10,
    )!;
    expect(profile.totalVolume).toBeCloseTo(10, 6);
    expect(profile.poc).toBeCloseTo(100, 6);
  });

  it("берёт только свечи внутри окна", () => {
    const profile = profileFromFootprint(
      [fp(1, [{ price: 100, buy: 50, sell: 50 }]), fp(500, [{ price: 200, buy: 1, sell: 1 }])],
      400,
      600,
    )!;
    expect(profile.totalVolume).toBeCloseTo(2, 6);
    expect(profile.poc).toBeCloseTo(200, 6);
  });

  it("возвращает null, когда footprint пуст", () => {
    expect(profileFromFootprint([], 0, 10)).toBeNull();
    expect(profileFromFootprint([fp(1, [])], 0, 10)).toBeNull();
  });

  it("раскладывает цены по бинам видимого диапазона", () => {
    const levels = Array.from({ length: 100 }, (_, i) => ({ price: 100 + i, buy: 1, sell: 0 }));
    const profile = profileFromFootprint([fp(1, levels)], 0, 10)!;
    expect(profile.levels).toHaveLength(60);
    expect(profile.totalVolume).toBeCloseTo(100, 6);
  });
});
