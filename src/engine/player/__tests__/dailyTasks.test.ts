import { describe, it, expect } from "vitest";
import { evaluateDaily, freshDailyState, isComplete, taskProgress, tasksForDay, TASK_POOL, type DailyContext } from "@/engine/player/dailyTasks";
import type { Asset, JournalEntry, Position } from "@/engine/entities/types";

const assets: Asset[] = [
  { id: "A", symbol: "A", name: "A", assetClass: "stock", sector: "tech", correlationGroup: "t", baseVolatility: 0.3, baseDrift: 0.05, tickSize: 0.01, tradingHours: "session" },
  { id: "B", symbol: "B", name: "B", assetClass: "stock", sector: "energy", correlationGroup: "e", baseVolatility: 0.3, baseDrift: 0.05, tickSize: 0.01, tradingHours: "session" },
  { id: "C", symbol: "C", name: "C", assetClass: "stock", sector: "tech", correlationGroup: "t", baseVolatility: 0.3, baseDrift: 0.05, tickSize: 0.01, tradingHours: "session" },
];

function entry(gameDay: number, rMultiple = 0.5, pnl = 100): JournalEntry {
  return { id: crypto.randomUUID(), positionId: "p", timestampClosed: Date.now(), gameDay, pnl, rMultiple, tags: [] };
}

function position(assetId: string, closed = false): Position {
  return {
    id: crypto.randomUUID(),
    assetId,
    side: "long",
    entryPrice: 100,
    size: 1,
    leverage: 1,
    openedAt: 0,
    closedAt: closed ? 1 : undefined,
    fees: 0,
    style: "day",
  };
}

function ctx(overrides: Partial<DailyContext> = {}): DailyContext {
  return {
    day: 5,
    journal: [],
    positions: [],
    assets,
    dayStartEquity: 10_000,
    equity: 10_000,
    ...overrides,
  };
}

describe("tasksForDay", () => {
  it("выдаёт ровно три задания и одинаковые для одного дня", () => {
    const first = tasksForDay(12);
    expect(first).toHaveLength(3);
    expect(tasksForDay(12)).toEqual(first);
  });

  it("разные дни дают разные наборы", () => {
    const a = tasksForDay(3).map((t) => t.id).join();
    const b = tasksForDay(4).map((t) => t.id).join();
    expect(a).not.toBe(b);
  });

  it("id уникальны внутри дня — иначе одна награда закрывала бы два задания", () => {
    for (let day = 0; day < 40; day++) {
      const ids = tasksForDay(day).map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("каждое задание даёт и деньги, и опыт", () => {
    for (const task of TASK_POOL) {
      expect(task.rewardCash).toBeGreaterThan(0);
      expect(task.rewardXp).toBeGreaterThan(0);
    }
  });
});

describe("taskProgress", () => {
  const close3 = { id: "x", kind: "close_trades" as const, target: 3, rewardCash: 1, rewardXp: 1 };
  const stops2 = { id: "y", kind: "use_stops" as const, target: 2, rewardCash: 1, rewardXp: 1 };
  const profit = { id: "z", kind: "profit_day" as const, target: 1, rewardCash: 1, rewardXp: 1 };
  const diversify = { id: "d", kind: "diversify" as const, target: 3, rewardCash: 1, rewardXp: 1 };
  const survive = { id: "s", kind: "survive" as const, target: 1, rewardCash: 1, rewardXp: 1 };

  it("считает только сегодняшние сделки", () => {
    const journal = [entry(5), entry(5), entry(4)];
    expect(taskProgress(close3, ctx({ journal }))).toBe(2);
  });

  it("сделкой «со стопом» считается только та, у которой ненулевой R", () => {
    const journal = [entry(5, 0.8), entry(5, 0), entry(5, -1)];
    expect(taskProgress(stops2, ctx({ journal }))).toBe(2);
  });

  it("прибыльный день засчитывается по эквити относительно утра", () => {
    expect(taskProgress(profit, ctx({ equity: 10_500 }))).toBe(1);
    expect(taskProgress(profit, ctx({ equity: 9_900 }))).toBe(0);
  });

  it("диверсификация считает СЕКТОРА, а не позиции", () => {
    const positions = [position("A"), position("C"), position("B")]; // tech, tech, energy
    expect(taskProgress(diversify, ctx({ positions }))).toBe(2);
  });

  it("закрытые позиции в диверсификацию не входят", () => {
    expect(taskProgress(diversify, ctx({ positions: [position("A", true)] }))).toBe(0);
  });

  it("«пережить день» ломается ликвидацией (R хуже −1)", () => {
    expect(taskProgress(survive, ctx({ journal: [entry(5, -0.9)] }))).toBe(1);
    expect(taskProgress(survive, ctx({ journal: [entry(5, -1.6)] }))).toBe(0);
  });

  it("isComplete сравнивает с целью", () => {
    expect(isComplete(close3, ctx({ journal: [entry(5), entry(5)] }))).toBe(false);
    expect(isComplete(close3, ctx({ journal: [entry(5), entry(5), entry(5)] }))).toBe(true);
  });
});

describe("evaluateDaily", () => {
  it("смена дня обнуляет выполненные и ничего не выдаёт", () => {
    const state = { day: 4, completedIds: ["D4-0"] };
    const result = evaluateDaily(state, ctx({ day: 5 }));
    expect(result.state).toEqual({ day: 5, completedIds: [] });
    expect(result.rewardCash).toBe(0);
  });

  it("выдаёт награду один раз за задание", () => {
    // День 0: первое задание — «закрыть 3 сделки».
    const day = 0;
    const journal = [entry(day), entry(day), entry(day), entry(day), entry(day)];
    const first = evaluateDaily(freshDailyState(), ctx({ day, journal }));
    expect(first.rewardCash).toBeGreaterThan(0);
    const second = evaluateDaily(first.state, ctx({ day, journal }));
    expect(second.rewardCash).toBe(0);
    expect(second.completed).toEqual([]);
  });

  it("«пережить день» не выдаётся сразу — иначе награда приходила бы до торговли", () => {
    // Найдём день, в наборе которого есть survive.
    let day = 0;
    while (!tasksForDay(day).some((t) => t.kind === "survive") && day < 50) day++;
    const result = evaluateDaily({ day, completedIds: [] }, ctx({ day }));
    expect(result.completed.some((t) => t.kind === "survive")).toBe(false);
  });
});
