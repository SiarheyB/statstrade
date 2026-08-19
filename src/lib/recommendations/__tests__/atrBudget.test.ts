import { describe, it, expect } from "vitest";
import { falseBreakoutBudget, todayProgress, dayMoveOdds } from "../atrBudget";

describe("dayMoveOdds", () => {
  it("maps the move to the conspectus buckets", () => {
    expect(dayMoveOdds(0.5)).toBe(0.8);
    expect(dayMoveOdds(1)).toBe(0.8);
    expect(dayMoveOdds(1.24)).toBe(0.1);
    expect(dayMoveOdds(2)).toBe(0.1);
    expect(dayMoveOdds(2.5)).toBe(0.05);
    expect(dayMoveOdds(4)).toBe(0.02);
  });
});

describe("falseBreakoutBudget", () => {
  it("adds the pierce depth to the distance to the level", () => {
    // BICOUSDT 18.08.2026: цена 0.01877, уровень 0.01121, ATR 0.00649.
    const b = falseBreakoutBudget(0.01877, 0.01121, 0.00649, 0.08)!;
    expect(b.toLevelAtr).toBeCloseTo(1.16, 2);
    expect(b.totalAtr).toBeCloseTo(1.24, 2);
    expect(b.totalPrice).toBeCloseTo(0.00808, 5);
    // 1.24 ATR — уже не рядовой день: по конспекту такой ход бывает ~в 10%.
    expect(b.oddsShare).toBe(0.1);
    expect(b.feasibility).toBe("stretch");
  });

  it("calls a move within one ATR routine", () => {
    const b = falseBreakoutBudget(100, 99.4, 1, 0.08)!;
    expect(b.totalAtr).toBeCloseTo(0.68, 2);
    expect(b.feasibility).toBe("routine");
    expect(b.oddsShare).toBe(0.8);
  });

  it("flags a move beyond two ATR as unlikely", () => {
    const b = falseBreakoutBudget(100, 97.5, 1, 0.08)!;
    expect(b.feasibility).toBe("unlikely");
    expect(b.oddsShare).toBe(0.05);
  });

  it("works the same when the level is above the price", () => {
    const below = falseBreakoutBudget(100, 98.5, 1)!;
    const above = falseBreakoutBudget(100, 101.5, 1)!;
    expect(above.totalAtr).toBeCloseTo(below.totalAtr, 10);
  });

  it("returns null without a usable ATR", () => {
    expect(falseBreakoutBudget(100, 98, 0)).toBeNull();
    expect(falseBreakoutBudget(100, 98, Number.NaN)).toBeNull();
  });
});

describe("todayProgress", () => {
  it("reports the share of the daily ATR already spent", () => {
    const p = todayProgress(102, 100, 4)!;
    expect(p.movedAtr).toBeCloseTo(0.5, 5);
    expect(p.movedPct).toBeCloseTo(50, 5);
    expect(p.exhausted).toBe(false);
    expect(p.leftAtr).toBeCloseTo(0.5, 5);
  });

  it("marks the day as exhausted from 75% of the ATR", () => {
    expect(todayProgress(103, 100, 4)!.exhausted).toBe(true);
    expect(todayProgress(104, 100, 4)!.leftAtr).toBe(0);
  });

  it("returns null on broken input", () => {
    expect(todayProgress(100, 102, 4)).toBeNull();
    expect(todayProgress(102, 100, 0)).toBeNull();
  });
});
