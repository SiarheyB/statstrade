import { describe, it, expect } from "vitest";
import { randomNormal, roundToTickSize, simulateTick, tickVolume } from "@/engine/market/priceSimulation";
import { NEUTRAL_REGIME } from "@/engine/entities/types";
import { mulberry32 } from "@/engine/rng";
import type { Asset } from "@/engine/entities/types";

const asset: Asset = {
  id: "STK_TEST",
  symbol: "TEST",
  name: "Test Co",
  assetClass: "stock",
  correlationGroup: "tech_stocks",
  baseVolatility: 0.32,
  baseDrift: 0.09,
  tickSize: 0.01,
  tradingHours: "session",
};

describe("randomNormal", () => {
  it("детерминирован с сидированным rng и никогда не даёт NaN даже при u1=0", () => {
    const rng = mulberry32(1);
    const values = Array.from({ length: 1000 }, () => randomNormal(0, 1, rng));
    expect(values.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("среднее близко к mean, а разброс — к stdDev на большой выборке", () => {
    const rng = mulberry32(42);
    const n = 20000;
    const values = Array.from({ length: n }, () => randomNormal(5, 2, rng));
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    expect(mean).toBeCloseTo(5, 0);
    expect(Math.sqrt(variance)).toBeCloseTo(2, 0);
  });
});

describe("roundToTickSize", () => {
  it("округляет к ближайшему шагу цены", () => {
    expect(roundToTickSize(100.256, 0.01)).toBeCloseTo(100.26, 5);
    expect(roundToTickSize(100.253, 0.01)).toBeCloseTo(100.25, 5);
  });

  it("не трогает цену при нулевом/некорректном tickSize", () => {
    expect(roundToTickSize(100.123456, 0)).toBe(100.123456);
  });
});

describe("simulateTick", () => {
  it("детерминирован для одного и того же rng-сида (воспроизводимость тестов, раздел 26)", () => {
    const run = () => {
      const rng = mulberry32(7);
      let price = 100;
      for (let i = 0; i < 50; i++) {
        price = simulateTick({
          asset,
          currentPrice: price,
          dtYears: 1 / (365 * 24 * 60),
          regime: NEUTRAL_REGIME,
          activeVolMultiplier: 1,
          correlatedZ: randomNormal(0, 1, rng),
        });
      }
      return price;
    };
    expect(run()).toBe(run());
  });

  it("цена никогда не уходит в ноль/отрицательную область даже при экстремальном шоке (edge case раздела 26)", () => {
    const extreme = simulateTick({
      asset,
      currentPrice: 100,
      dtYears: 1,
      regime: NEUTRAL_REGIME,
      activeVolMultiplier: 1,
      correlatedZ: -1000, // искусственно огромный отрицательный шок
    });
    expect(extreme).toBeGreaterThan(0);
    expect(Number.isFinite(extreme)).toBe(true);
  });

  it("результат всегда выровнен по tickSize актива", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 30; i++) {
      const price = simulateTick({
        asset,
        currentPrice: 100 + i,
        dtYears: 1 / (365 * 24 * 60),
        regime: NEUTRAL_REGIME,
        activeVolMultiplier: 1,
        correlatedZ: randomNormal(0, 1, rng),
      });
      const scaled = price / asset.tickSize;
      expect(Math.abs(scaled - Math.round(scaled))).toBeLessThan(1e-6);
    }
  });

  it("положительный driftModifier в среднем толкает цену вверх на большой выборке путей", () => {
    const rng = mulberry32(99);
    const dtYears = 1 / 365; // 1 игровой день
    const trials = 2000;
    let ups = 0;
    for (let i = 0; i < trials; i++) {
      const price = simulateTick({
        asset: { ...asset, baseDrift: 0.5, baseVolatility: 0.05 }, // сильный снос, малая волатильность
        currentPrice: 100,
        dtYears,
        regime: NEUTRAL_REGIME,
        activeVolMultiplier: 1,
        correlatedZ: randomNormal(0, 1, rng),
      });
      if (price > 100) ups++;
    }
    expect(ups / trials).toBeGreaterThan(0.5);
  });
});

describe("tickVolume", () => {
  it("тихий дрейф даёт фоновый объём, резкое движение — всплеск", () => {
    const rng = () => 0.5;
    const quiet = tickVolume(0.0001, rng);
    const spike = tickVolume(0.02, rng);
    expect(quiet).toBeGreaterThan(0);
    expect(spike).toBeGreaterThan(quiet * 3);
  });

  it("направление движения на объём не влияет — важен размах", () => {
    const rng = () => 0.5;
    expect(tickVolume(0.01, rng)).toBeCloseTo(tickVolume(-0.01, rng), 10);
  });

  it("объём всегда положительный, даже при нулевом движении", () => {
    expect(tickVolume(0, () => 0)).toBeGreaterThan(0);
  });

  it("случайный множитель разводит объём по соседним тикам", () => {
    const low = tickVolume(0.001, () => 0);
    const high = tickVolume(0.001, () => 1);
    expect(high).toBeGreaterThan(low * 2);
  });
});
