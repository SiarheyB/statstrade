import { describe, it, expect } from "vitest";
import {
  clusterByFlat,
  findGroupCandidates,
  aggregateGroup,
  spreadLevel,
  validateSelection,
  type GroupMember,
} from "../grouping";

const at = (s: string) => new Date(`2026-09-25T${s}Z`);

function pos(
  id: string,
  entry: string,
  exit: string,
  entryPrice: number,
  exitPrice: number,
  netPnl: number,
  over: Partial<GroupMember & { symbol: string }> = {},
): GroupMember & { symbol: string } {
  return {
    id,
    symbol: "GBPJPY",
    side: "long",
    lots: 0.01,
    qty: 1000,
    entryTime: at(entry),
    exitTime: at(exit),
    entryPrice,
    exitPrice,
    stopLoss: 208.751,
    takeProfit: 211.285,
    commission: 0.04,
    swap: 0,
    grossProfit: netPnl,
    netPnl: netPnl - 0.04,
    ...over,
  };
}

// Реальная сетка ClickGrid 5/5 из отчёта MT5 (GBPJPY, 25.09.2026): пять лимиток
// по 0.01 лота с общим стопом 208.751, закрыты все одним стопом в 12:18:43.
const grid = [
  pos("a", "11:17:51", "12:18:43", 209.383, 208.731, -3.39),
  pos("b", "11:18:07", "12:18:43", 209.353, 208.731, -3.94),
  pos("c", "11:49:32", "12:18:43", 209.328, 208.731, -3.57),
  pos("d", "11:57:30", "12:18:43", 209.294, 208.731, -4.13),
  pos("e", "11:57:35", "12:18:43", 209.265, 208.731, -3.79),
];

describe("clusterByFlat", () => {
  it("собирает сетку из пяти лимиток в один кластер", () => {
    const clusters = clusterByFlat(grid);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(5);
  });

  it("разделяет две сетки, между которыми позиция была закрыта", () => {
    const second = [
      pos("f", "14:30:00", "15:00:00", 210.0, 211.0, 10),
      pos("g", "14:31:00", "15:00:00", 209.9, 211.0, 11),
    ];
    const clusters = clusterByFlat([...grid, ...second]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].map((m) => m.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(clusters[1].map((m) => m.id)).toEqual(["f", "g"]);
  });

  it("не слепляет сделки, открытую в ту же секунду, что закрылась предыдущая", () => {
    // MT5 пишет время с точностью до секунды. Закрытия применяются раньше
    // открытий, поэтому объём успевает обнулиться.
    const clusters = clusterByFlat([
      pos("x", "10:00:00", "11:00:00", 200, 201, 5),
      pos("y", "11:00:00", "12:00:00", 201, 202, 5),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it("не склеивает A и C через общего соседа B (пересечение не транзитивно)", () => {
    // A: 10:00–10:30, B: 10:20–11:20, C: 11:00–11:30. A и C не пересекаются,
    // но позиция между ними ни разу не обнулялась — это одна непрерывная
    // сделка, и кластер честно один.
    const chain = clusterByFlat([
      pos("A", "10:00:00", "10:30:00", 200, 200, 0),
      pos("B", "10:20:00", "11:20:00", 200, 200, 0),
      pos("C", "11:00:00", "11:30:00", 200, 200, 0),
    ]);
    expect(chain).toHaveLength(1);
    // А вот с разрывом посередине — уже два кластера.
    const split = clusterByFlat([
      pos("A", "10:00:00", "10:30:00", 200, 200, 0),
      pos("C", "11:00:00", "11:30:00", 200, 200, 0),
    ]);
    expect(split).toHaveLength(2);
  });

  it("одиночная позиция даёт кластер из одной сделки", () => {
    expect(clusterByFlat([grid[0]])).toHaveLength(1);
  });
});

describe("findGroupCandidates", () => {
  it("предлагает только кластеры от двух позиций", () => {
    const single = pos("solo", "16:00:00", "16:30:00", 210, 210.5, 5);
    const found = findGroupCandidates([...grid, single]);
    expect(found).toHaveLength(1);
    expect(found[0]).toHaveLength(5);
  });

  it("не смешивает разные инструменты и разные стороны", () => {
    const other = [
      pos("s1", "11:20:00", "12:00:00", 1.1, 1.2, 5, { symbol: "EURUSD" }),
      pos("s2", "11:25:00", "12:00:00", 1.1, 1.2, 5, { symbol: "EURUSD" }),
      pos("h1", "11:20:00", "12:00:00", 209, 209, 0, { side: "short" }),
    ];
    const found = findGroupCandidates([...grid, ...other]);
    expect(found).toHaveLength(2);
    expect(found.some((c) => c.every((m) => m.symbol === "EURUSD"))).toBe(true);
    // short-позиция осталась одна и в кандидаты не попала
    expect(found.flat().some((m) => m.side === "short")).toBe(false);
  });
});

describe("aggregateGroup", () => {
  it("сводит сетку к средневзвешенным ценам и суммарным деньгам", () => {
    const g = aggregateGroup(grid);
    expect(g.memberCount).toBe(5);
    expect(g.lots).toBeCloseTo(0.05, 10);
    expect(g.entryPrice).toBeCloseTo(209.3246, 4);
    expect(g.exitPrice).toBeCloseTo(208.731, 6);
    expect(g.stopLoss).toBeCloseTo(208.751, 6);
    expect(g.takeProfit).toBeCloseTo(211.285, 6);
    // netPnl — сумма брокерских значений, а не пересчёт по ценам
    expect(g.netPnl).toBeCloseTo(-19.02, 6);
    expect(g.commission).toBeCloseTo(0.2, 6);
    expect(g.entryTime.toISOString()).toBe(at("11:17:51").toISOString());
    expect(g.exitTime.toISOString()).toBe(at("12:18:43").toISOString());
    // стопы совпадают → разброса нет
    expect(g.stopSpread).toBe(0);
    expect(spreadLevel(g.stopSpread)).toBe("exact");
  });

  it("взвешивает по лотам, а не арифметически", () => {
    const uneven = [
      pos("p1", "11:00:00", "12:00:00", 200, 201, 1, { lots: 0.01 }),
      pos("p2", "11:05:00", "12:00:00", 210, 201, 1, { lots: 0.03 }),
    ];
    const g = aggregateGroup(uneven);
    // арифметическое среднее дало бы 205; с весами 0.01/0.03 — 207.5
    expect(g.entryPrice).toBeCloseTo(207.5, 6);
  });

  it("считает разброс стопов в долях риска", () => {
    const spread = aggregateGroup([
      pos("q1", "11:00:00", "12:00:00", 209.3, 208.7, -3, { stopLoss: 208.7 }),
      pos("q2", "11:05:00", "12:00:00", 209.3, 208.7, -3, { stopLoss: 208.8 }),
    ]);
    // средний стоп 208.75, риск 0.55, разброс 0.1 → 0.1/0.55 ≈ 0.18
    expect(spread.stopSpread).toBeCloseTo(0.1 / 0.55, 4);
    expect(spread.stopMin).toBeCloseTo(208.7, 6);
    expect(spread.stopMax).toBeCloseTo(208.8, 6);
    expect(spreadLevel(spread.stopSpread)).toBe("warn");
  });

  it("усредняет стоп только по позициям, где он задан", () => {
    const g = aggregateGroup([
      pos("r1", "11:00:00", "12:00:00", 209, 208, -3, { stopLoss: 208.5 }),
      pos("r2", "11:05:00", "12:00:00", 209, 208, -3, { stopLoss: null }),
    ]);
    expect(g.stopLoss).toBeCloseTo(208.5, 6);
  });

  it("группа без единого стопа остаётся без стопа и без разброса", () => {
    const g = aggregateGroup([
      pos("n1", "11:00:00", "12:00:00", 209, 208, -3, { stopLoss: null, takeProfit: null }),
      pos("n2", "11:05:00", "12:00:00", 209, 208, -3, { stopLoss: null, takeProfit: null }),
    ]);
    expect(g.stopLoss).toBeNull();
    expect(g.takeProfit).toBeNull();
    expect(g.stopSpread).toBeNull();
    expect(spreadLevel(g.stopSpread)).toBe("exact");
  });
});

describe("spreadLevel", () => {
  it("мелкий разброс не тревожит, крупный предупреждает", () => {
    expect(spreadLevel(0)).toBe("exact");
    expect(spreadLevel(0.05)).toBe("minor");
    expect(spreadLevel(0.1)).toBe("minor");
    expect(spreadLevel(0.11)).toBe("warn");
  });
});

describe("validateSelection", () => {
  it("пропускает однородный набор", () => {
    expect(validateSelection(grid).ok).toBe(true);
  });

  it("запрещает одну позицию, разные стороны и разные инструменты", () => {
    expect(validateSelection([grid[0]])).toEqual({ ok: false, reason: "tooFew" });
    expect(
      validateSelection([grid[0], { ...grid[1], side: "short" }]),
    ).toEqual({ ok: false, reason: "mixedSides" });
    expect(
      validateSelection([grid[0], { ...grid[1], symbol: "EURUSD" }]),
    ).toEqual({ ok: false, reason: "mixedSymbols" });
  });
});
