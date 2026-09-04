import { describe, it, expect } from "vitest";
import {
  CASH_KEY,
  diversificationScore,
  herfindahl,
  investedShare,
  largestExposure,
  portfolioSlices,
  UNKNOWN_KEY,
} from "@/engine/player/diversification";
import type { Asset, Position } from "@/engine/entities/types";

const assets: Asset[] = [
  { id: "A", symbol: "A", name: "A", assetClass: "stock", sector: "tech", correlationGroup: "tech_stocks", baseVolatility: 0.3, baseDrift: 0.05, tickSize: 0.01, tradingHours: "session" },
  { id: "B", symbol: "B", name: "B", assetClass: "stock", sector: "energy", correlationGroup: "energy_stocks", baseVolatility: 0.3, baseDrift: 0.05, tickSize: 0.01, tradingHours: "session" },
  { id: "C", symbol: "C", name: "C", assetClass: "bond", correlationGroup: "bonds", baseVolatility: 0.05, baseDrift: 0.03, tickSize: 0.01, tradingHours: "session" },
];

function pos(overrides: Partial<Position> = {}): Position {
  return {
    id: "p",
    assetId: "A",
    side: "long",
    entryPrice: 100,
    size: 10,
    leverage: 1,
    openedAt: 0,
    fees: 0,
    style: "investing",
    ...overrides,
  };
}

const prices = { A: 100, B: 100, C: 100 };

describe("portfolioSlices", () => {
  it("считает доли по секторам и включает свободные деньги отдельной долей", () => {
    const slices = portfolioSlices([pos({ id: "p1" })], assets, prices, 1_000, "sector");
    expect(slices).toEqual([
      { key: "tech", value: 1_000, weight: 0.5 },
      { key: CASH_KEY, value: 1_000, weight: 0.5 },
    ]);
  });

  it("складывает несколько позиций одного сектора в одну долю", () => {
    const slices = portfolioSlices(
      [pos({ id: "p1", assetId: "A", size: 10 }), pos({ id: "p2", assetId: "A", size: 5 })],
      assets,
      prices,
      0,
      "sector",
    );
    expect(slices).toEqual([{ key: "tech", value: 1_500, weight: 1 }]);
  });

  it("шорт считается экспозицией по модулю, а не отрицательной долей", () => {
    const slices = portfolioSlices([pos({ id: "p1", side: "short" })], assets, prices, 0, "sector");
    expect(slices[0]).toEqual({ key: "tech", value: 1_000, weight: 1 });
  });

  it("закрытые позиции в портфель не входят", () => {
    const slices = portfolioSlices([pos({ id: "p1", closedAt: 123 })], assets, prices, 500, "sector");
    expect(slices).toEqual([{ key: CASH_KEY, value: 500, weight: 1 }]);
  });

  it("актив без сектора (облигация) попадает в 'other' по секторам и в 'bond' по классам", () => {
    const bond = [pos({ id: "p1", assetId: "C" })];
    expect(portfolioSlices(bond, assets, prices, 0, "sector")[0].key).toBe(UNKNOWN_KEY);
    expect(portfolioSlices(bond, assets, prices, 0, "assetClass")[0].key).toBe("bond");
  });

  it("пустой портфель без денег — пустой список, а не деление на ноль", () => {
    expect(portfolioSlices([], assets, prices, 0, "sector")).toEqual([]);
  });
});

describe("метрики концентрации", () => {
  const twoEqual = portfolioSlices([pos({ id: "p1", assetId: "A" }), pos({ id: "p2", assetId: "B" })], assets, prices, 0, "sector");

  it("HHI двух равных долей = 0.5, одной доли = 1", () => {
    expect(herfindahl(twoEqual)).toBeCloseTo(0.5, 10);
    expect(herfindahl(portfolioSlices([pos({ id: "p1" })], assets, prices, 0, "sector"))).toBe(1);
  });

  it("оценка диверсификации растёт с числом равных долей", () => {
    expect(diversificationScore(portfolioSlices([pos({ id: "p1" })], assets, prices, 0, "sector"))).toBe(0);
    expect(diversificationScore(twoEqual)).toBe(50);
    expect(diversificationScore([])).toBe(0);
  });

  it("крупнейшая экспозиция игнорирует кэш", () => {
    const slices = portfolioSlices([pos({ id: "p1", size: 1 })], assets, prices, 100_000, "sector");
    expect(largestExposure(slices)?.key).toBe("tech");
    expect(largestExposure(portfolioSlices([], assets, prices, 100, "sector"))).toBeNull();
  });

  it("вложенная доля — всё, кроме кэша", () => {
    const slices = portfolioSlices([pos({ id: "p1" })], assets, prices, 3_000, "sector");
    expect(investedShare(slices)).toBeCloseTo(0.25, 10);
  });
});
