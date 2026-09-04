import { describe, it, expect } from "vitest";
import { screenAssets } from "@/engine/market/screener";
import type { Asset, Candle } from "@/engine/entities/types";

function asset(id: string, symbol: string): Asset {
  return {
    id,
    symbol,
    name: symbol,
    assetClass: "stock",
    correlationGroup: "g",
    baseVolatility: 0.3,
    baseDrift: 0.05,
    tickSize: 0.01,
    tradingHours: "session",
  };
}

function candles(values: number[]): Candle[] {
  return values.map((v, i) => ({ timestamp: i * 1000, open: v, high: v * 1.01, low: v * 0.99, close: v, volume: 0 }));
}

const assets = [asset("A", "AAA"), asset("B", "BBB"), asset("C", "CCC")];

describe("screenAssets", () => {
  it("считает изменение от открытия окна к текущей цене", () => {
    const rows = screenAssets(assets.slice(0, 1), { A: candles([100, 101, 102]) }, { A: 110 });
    expect(rows[0].changePct).toBeCloseTo(10, 5);
  });

  it("сортирует по модулю движения: падение важнее слабого роста", () => {
    const rows = screenAssets(
      assets,
      { A: candles([100, 100]), B: candles([100, 100]), C: candles([100, 100]) },
      { A: 100.5, B: 92, C: 103 },
    );
    expect(rows.map((r) => r.symbol)).toEqual(["BBB", "CCC", "AAA"]);
  });

  it("размах считается по максимуму и минимуму окна", () => {
    const series: Candle[] = [
      { timestamp: 0, open: 100, high: 120, low: 95, close: 110, volume: 0 },
      { timestamp: 1, open: 110, high: 115, low: 90, close: 100, volume: 0 },
    ];
    const rows = screenAssets(assets.slice(0, 1), { A: series }, { A: 100 });
    expect(rows[0].rangePct).toBeCloseTo(((120 - 90) / 90) * 100, 5);
  });

  it("инструмент без истории не выпадает из списка, а показывает ноль", () => {
    const rows = screenAssets(assets.slice(0, 1), {}, { A: 100 });
    expect(rows).toEqual([{ assetId: "A", symbol: "AAA", price: 100, changePct: 0, rangePct: 0 }]);
  });

  it("инструмент без цены пропускается — рисовать нечего", () => {
    expect(screenAssets(assets.slice(0, 1), {}, {})).toEqual([]);
  });

  it("окно ограничено lookback: старые свечи не влияют", () => {
    const series = candles([10, 20, 30, 100, 100]);
    const rows = screenAssets(assets.slice(0, 1), { A: series }, { A: 100 }, 2);
    // последние два бара открылись на 100 — движения нет
    expect(rows[0].changePct).toBeCloseTo(0, 5);
  });
});
