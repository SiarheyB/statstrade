import { describe, it, expect } from "vitest";
import { resultWithBreakeven, markedByKeys, resultSql, moneyResultSql } from "@/lib/analytics/breakeven";
import { computeMetrics } from "@/lib/analytics/metrics";
import type { RoundTripTrade } from "@/lib/analytics/types";

const base = {
  symbol: "USDCHF",
  base: "USD",
  quote: "CHF",
  market: "forex",
  exchange: "mt5",
  accountId: "acc-1",
  side: "short" as const,
  entryTime: new Date("2026-10-13T10:00:00Z"),
  exitTime: new Date("2026-10-14T10:00:00Z"),
  durationMs: 86_400_000,
  qty: 6000,
  entryPrice: 0.833,
  exitPrice: 0.8335,
  fees: 0.3,
  fillCount: 1,
  returnPct: 0,
};

function trade(p: Partial<RoundTripTrade> & { id: string }): RoundTripTrade {
  const netPnl = p.netPnl ?? 0;
  return {
    ...base,
    grossPnl: netPnl,
    netPnl,
    result: netPnl > 1e-9 ? "win" : netPnl < -1e-9 ? "loss" : "breakeven",
    ...p,
  } as RoundTripTrade;
}

describe("resultWithBreakeven", () => {
  it("пометка перебивает результат по деньгам", () => {
    expect(resultWithBreakeven("loss", true)).toBe("breakeven");
    expect(resultWithBreakeven("win", true)).toBe("breakeven");
  });

  it("без пометки результат не трогается", () => {
    expect(resultWithBreakeven("loss", false)).toBe("loss");
    expect(resultWithBreakeven("loss", null)).toBe("loss");
    // LEFT JOIN не нашёл аннотации — это «не помечено», а не «неизвестно».
    expect(resultWithBreakeven("win", undefined)).toBe("win");
  });
});

describe("markedByKeys", () => {
  it("пустой список ключей — заведомо ложное условие, а не IN ()", () => {
    // `IN ()` Postgres не принимает, и запрос падал бы у всех, кто ничего не помечал.
    expect(markedByKeys({ strings: ['"id"'], values: [] } as never, []).sql).toContain("FALSE");
  });

  it("с ключами строит IN", () => {
    const sql = markedByKeys(moneyResultSql("t"), ["acc:1", "acc:2"]);
    expect(sql.values).toEqual(["acc:1", "acc:2"]);
  });

  it("resultSql подставляет breakeven перед базовым выражением", () => {
    const sql = resultSql(moneyResultSql("t"), markedByKeys(moneyResultSql("t"), ["k"]));
    expect(sql.sql).toContain("CASE WHEN");
    expect(sql.sql).toContain("'breakeven'");
  });
});

describe("безубыток в метриках", () => {
  // Та самая сделка со скриншота: вышел перед новостями, минус в −5,32 $ —
  // это своп и спред, а не стоп.
  const trades = [
    trade({ id: "w1", netPnl: 148.2, rr: 2.96 }),
    trade({ id: "be", netPnl: -5.32, rr: -0.21, result: "breakeven" }),
    trade({ id: "l1", netPnl: -49.8, rr: -1 }),
  ];

  it("не попадает ни в победы, ни в убытки", () => {
    const m = computeMetrics(trades);
    expect(m.wins).toBe(1);
    expect(m.losses).toBe(1);
    expect(m.breakevens).toBe(1);
  });

  it("винрейт считается без безубытков в знаменателе", () => {
    const m = computeMetrics(trades);
    // 1 победа из 2 решённых, а не из 3 сделок.
    expect(m.winRate).toBe(50);
    expect(m.lossRate).toBe(50);
  });

  it("деньги остаются настоящими", () => {
    const m = computeMetrics(trades);
    // −5,32 $ списаны брокером и обязаны быть в P&L, иначе цифры разойдутся
    // с выпиской.
    expect(m.totalNetPnl).toBeCloseTo(148.2 - 5.32 - 49.8, 10);
    // При этом ни в валовую прибыль, ни в валовый убыток БУ не входит.
    expect(m.grossProfit).toBeCloseTo(148.2, 10);
    expect(m.grossLoss).toBeCloseTo(49.8, 10);
  });

  it("серию убытков не продолжает", () => {
    const m = computeMetrics([
      trade({ id: "l1", netPnl: -50 }),
      trade({ id: "be", netPnl: -5, result: "breakeven" }),
      trade({ id: "l2", netPnl: -50 }),
    ]);
    // Три красные строки подряд в отчёте — но стопов среди них два.
    expect(m.largestLossStreak).toBe(2);
  });

  it("без пометки та же сделка остаётся убытком", () => {
    const m = computeMetrics([
      trade({ id: "w1", netPnl: 148.2 }),
      trade({ id: "be", netPnl: -5.32 }),
      trade({ id: "l1", netPnl: -49.8 }),
    ]);
    expect(m.losses).toBe(2);
    expect(m.breakevens).toBe(0);
    expect(m.winRate).toBeCloseTo(33.333, 2);
  });
});
