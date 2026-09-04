import { describe, it, expect } from "vitest";
import { calculatePortfolioMetrics } from "@/engine/player/portfolioMetrics";
import type { JournalEntry } from "@/engine/entities/types";

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: crypto.randomUUID(),
    positionId: "p1",
    timestampClosed: Date.now(),
    pnl: 0,
    rMultiple: 0,
    tags: [],
    ...overrides,
  };
}

describe("calculatePortfolioMetrics", () => {
  it("пустой журнал — все метрики null/0", () => {
    const m = calculatePortfolioMetrics([], 10000);
    expect(m.totalTrades).toBe(0);
    expect(m.winRate).toBeNull();
    expect(m.avgRMultiple).toBeNull();
    expect(m.maxDrawdownPct).toBeNull();
  });

  it("winRate = доля прибыльных сделок", () => {
    const journal = [
      entry({ pnl: 100, timestampClosed: 1 }),
      entry({ pnl: -50, timestampClosed: 2 }),
      entry({ pnl: 30, timestampClosed: 3 }),
      entry({ pnl: -10, timestampClosed: 4 }),
    ];
    const m = calculatePortfolioMetrics(journal, 10000);
    expect(m.winRate).toBeCloseTo(0.5, 5);
    expect(m.totalTrades).toBe(4);
  });

  it("avgRMultiple = среднее по всем сделкам", () => {
    const journal = [
      entry({ rMultiple: 2, timestampClosed: 1 }),
      entry({ rMultiple: -1, timestampClosed: 2 }),
      entry({ rMultiple: 1, timestampClosed: 3 }),
    ];
    const m = calculatePortfolioMetrics(journal, 10000);
    expect(m.avgRMultiple).toBeCloseTo((2 - 1 + 1) / 3, 5);
  });

  it("maxDrawdownPct считает просадку от пика эквити, а не от старта", () => {
    // Старт 10000 → +2000 (пик 12000) → -3000 (10x2000-3000=... ) → просадка от 12000 к 9000 = 25%.
    const journal = [
      entry({ pnl: 2000, timestampClosed: 1 }),
      entry({ pnl: -3000, timestampClosed: 2 }),
    ];
    const m = calculatePortfolioMetrics(journal, 10000);
    expect(m.maxDrawdownPct).toBeCloseTo(25, 5);
  });

  it("считает по хронологии timestampClosed, а не по порядку в массиве", () => {
    const journal = [
      entry({ pnl: -3000, timestampClosed: 2 }), // на самом деле вторая
      entry({ pnl: 2000, timestampClosed: 1 }), // на самом деле первая
    ];
    const m = calculatePortfolioMetrics(journal, 10000);
    expect(m.maxDrawdownPct).toBeCloseTo(25, 5); // тот же результат, что и в хронологическом порядке
  });

  it("simplifiedSharpe = avgR / stdev(R), null при единственной сделке (нет разброса)", () => {
    const journal = [entry({ rMultiple: 1, timestampClosed: 1 })];
    const m = calculatePortfolioMetrics(journal, 10000);
    expect(m.simplifiedSharpe).toBeNull();
  });

  it("simplifiedSharpe считается на разбросе из нескольких сделок", () => {
    const journal = [
      entry({ rMultiple: 2, timestampClosed: 1 }),
      entry({ rMultiple: 1, timestampClosed: 2 }),
      entry({ rMultiple: -1, timestampClosed: 3 }),
    ];
    const m = calculatePortfolioMetrics(journal, 10000);
    expect(m.simplifiedSharpe).not.toBeNull();
    expect(Number.isFinite(m.simplifiedSharpe)).toBe(true);
  });
});
