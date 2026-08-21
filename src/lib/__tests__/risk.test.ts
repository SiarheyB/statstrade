import { describe, it, expect } from "vitest";
import {
  defaultRiskProfile,
  parseRiskProfile,
  serializeLossLimits,
  serializeRiskPerTrade,
  riskPerTradeAmount,
  computeAccountRisk,
  tradeRR,
  stopDistanceRR,
} from "@/lib/risk";
import type { HourBucket } from "@/lib/analytics/periods";

const NOW = new Date("2024-06-15T12:00:00Z");
const today = (h: number) => new Date(`2024-06-15T${String(h).padStart(2, "0")}:00:00Z`);
const may = (d: number) => new Date(`2024-05-${String(d).padStart(2, "0")}T10:00:00Z`);

type TestTrade = { netPnl: number; result: string; exitTime: Date };

function trade(netPnl: number, result: string, exitTime: Date): TestTrade {
  return { netPnl, exitTime, result };
}

// Свернуть сделки в ЧАСОВЫЕ бакеты — ровно так же, как это делает SQL в
// lib/analytics/hourly.ts (час = начало часа exitTime в UTC, безубыточные не
// попадают ни в wins, ни в losses). Кейсы ниже остаются описанными в терминах
// СДЕЛОК: так видно, что переход риск-менеджера на агрегат не изменил ни одного
// ожидаемого числа.
function toHours(trades: TestTrade[]): HourBucket[] {
  const map = new Map<number, HourBucket>();
  for (const t of trades) {
    const key = Date.UTC(
      t.exitTime.getUTCFullYear(),
      t.exitTime.getUTCMonth(),
      t.exitTime.getUTCDate(),
      t.exitTime.getUTCHours(),
    );
    const h = map.get(key) ?? {
      hour: new Date(key), netPnl: 0, wins: 0, losses: 0, winR: 0, lossR: 0, trades: 0,
    };
    h.netPnl += t.netPnl;
    h.trades += 1;
    if (t.result === "win") h.wins += 1;
    else if (t.result === "loss") h.losses += 1;
    map.set(key, h);
  }
  return [...map.values()];
}

describe("risk profile parsing", () => {
  it("defaultRiskProfile is all-off", () => {
    const p = defaultRiskProfile();
    expect(p.enabled).toBe(false);
    expect(p.maxStopsPerDay).toBeNull();
    expect(p.riskPerTrade.on).toBe(false);
    expect(Object.values(p.lossLimits).every((l) => !l.on)).toBe(true);
  });

  it("parseRiskProfile returns default for null", () => {
    expect(parseRiskProfile(null)).toEqual(defaultRiskProfile());
  });

  it("parseRiskProfile tolerates malformed JSON", () => {
    const p = parseRiskProfile({ enabled: true, riskPerTrade: "{bad", lossLimits: "nope" });
    expect(p.enabled).toBe(true);
    expect(p.riskPerTrade.on).toBe(false);
  });

  it("parseRiskProfile parses valid riskPerTrade and lossLimits", () => {
    const p = parseRiskProfile({
      enabled: true,
      maxStopsPerDay: 3,
      riskPerTrade: JSON.stringify({ on: true, value: 2, unit: "amount" }),
      lossLimits: JSON.stringify({ month: { on: true, value: 10, unit: "pct" } }),
    });
    expect(p.enabled).toBe(true);
    expect(p.maxStopsPerDay).toBe(3);
    expect(p.riskPerTrade).toMatchObject({ on: true, value: 2, unit: "amount" });
    expect(p.lossLimits.month).toMatchObject({ on: true, value: 10, unit: "pct" });
  });

  it("parseRiskProfile clamps non-positive maxStopsPerDay to null", () => {
    expect(parseRiskProfile({ maxStopsPerDay: 0 }).maxStopsPerDay).toBeNull();
    expect(parseRiskProfile({ maxStopsPerDay: -5 }).maxStopsPerDay).toBeNull();
  });

  it("serialize round-trips lossLimits and riskPerTrade", () => {
    const p = defaultRiskProfile();
    p.lossLimits.week = { on: true, value: 5, unit: "pct" };
    expect(JSON.parse(serializeLossLimits(p.lossLimits))).toEqual(p.lossLimits);
    expect(JSON.parse(serializeRiskPerTrade(p.riskPerTrade))).toEqual(p.riskPerTrade);
  });
});

describe("riskPerTradeAmount", () => {
  const profile = (over: Partial<{ enabled: boolean; unit: "pct" | "amount"; value: number }> = {}) => {
    const p = defaultRiskProfile();
    p.enabled = over.enabled ?? true;
    p.riskPerTrade = { on: true, value: over.value ?? 2, unit: over.unit ?? "pct" };
    return p;
  };

  it("is null when disabled / off / non-positive", () => {
    expect(riskPerTradeAmount(defaultRiskProfile(), 1000)).toBeNull();
    expect(riskPerTradeAmount(profile({ value: 0 }), 1000)).toBeNull();
  });

  it("returns the amount directly in amount mode", () => {
    expect(riskPerTradeAmount(profile({ unit: "amount", value: 50 }), 1000)).toBe(50);
  });

  it("is null for pct without a positive balance", () => {
    expect(riskPerTradeAmount(profile({ value: 2 }), null)).toBeNull();
    expect(riskPerTradeAmount(profile({ value: 2 }), 0)).toBeNull();
  });

  it("computes pct of balance", () => {
    expect(riskPerTradeAmount(profile({ value: 2 }), 1000)).toBe(20);
  });
});

describe("computeAccountRisk", () => {
  const onProfile = (over: Partial<ReturnType<typeof defaultRiskProfile>> = {}): ReturnType<typeof defaultRiskProfile> => {
    const p = defaultRiskProfile();
    p.enabled = true;
    return { ...p, ...over };
  };

  it("is off when the profile is disabled", () => {
    const r = computeAccountRisk("a1", [], 1000, defaultRiskProfile(), 0, NOW);
    expect(r.enabled).toBe(false);
    expect(r.state).toBe("off");
    expect(r.limits).toEqual([]);
  });

  it("reports ok with no configured limits", () => {
    const r = computeAccountRisk("a1", [], 1000, onProfile(), 0, NOW);
    expect(r.state).toBe("ok");
    expect(r.limits).toEqual([]);
  });

  it("counts net stops (wins offset losses) without 1R", () => {
    const profile = onProfile();
    profile.maxStopsPerDay = 3;
    const trades = [trade(-100, "loss", today(9)), trade(-100, "loss", today(10)), trade(100, "win", today(11))];
    const r = computeAccountRisk("a1", toHours(trades), 1000, profile, 0, NOW);
    const stops = r.limits.find((l) => l.key === "stops")!;
    expect(stops.used).toBe(1); // 2 losses − 1 win
    expect(stops.state).toBe("ok");
    expect(stops.pct).toBeCloseTo(1 / 3);
  });

  it("flags breached when net stops reach the limit", () => {
    const profile = onProfile();
    profile.maxStopsPerDay = 2;
    const trades = [trade(-100, "loss", today(9)), trade(-100, "loss", today(10))];
    const r = computeAccountRisk("a1", toHours(trades), 1000, profile, 0, NOW);
    expect(r.limits.find((l) => l.key === "stops")!.state).toBe("breached");
  });

  it("flags warning at ≥80% of the stop limit", () => {
    const profile = onProfile();
    profile.maxStopsPerDay = 5;
    const trades = [trade(-100, "loss", today(9)), trade(-100, "loss", today(10)), trade(-100, "loss", today(11)), trade(-100, "loss", today(12))];
    const r = computeAccountRisk("a1", toHours(trades), 1000, profile, 0, NOW);
    expect(r.limits.find((l) => l.key === "stops")!.state).toBe("warning");
  });

  it("nets stops by R-multiple when 1R is configured", () => {
    const profile = onProfile();
    profile.maxStopsPerDay = 3;
    profile.riskPerTrade = { on: true, value: 100, unit: "amount" };
    // 2 stops (−1R each) + 1 take (+3R) → net profit → 0 stops used.
    const trades = [trade(-100, "loss", today(9)), trade(-100, "loss", today(10)), trade(300, "win", today(11))];
    const r = computeAccountRisk("a1", toHours(trades), 1000, profile, 0, NOW);
    expect(r.limits.find((l) => l.key === "stops")!.used).toBe(0);
  });

  it("evaluates a percentage loss limit against balance", () => {
    const profile = onProfile();
    profile.lossLimits.month = { on: true, value: 10, unit: "pct" };
    const trades = [
      trade(-60, "loss", new Date("2024-06-02T10:00:00Z")),
      trade(-60, "loss", new Date("2024-06-10T10:00:00Z")),
    ]; // 120 loss in June
    const r = computeAccountRisk("a1", toHours(trades), 1000, profile, 0, NOW); // limit = 100
    const m = r.limits.find((l) => l.key === "month")!;
    expect(m.limit).toBe(100);
    expect(m.used).toBe(120);
    expect(m.state).toBe("breached");
  });

  it("evaluates an absolute loss limit without balance", () => {
    const profile = onProfile();
    profile.lossLimits.day = { on: true, value: 200, unit: "amount" };
    const trades = [trade(-90, "loss", today(9))];
    const r = computeAccountRisk("a1", toHours(trades), null, profile, 0, NOW); // pct would need balance; amount doesn't
    const d = r.limits.find((l) => l.key === "day")!;
    expect(d.limit).toBe(200);
    expect(d.used).toBe(90);
    expect(d.state).toBe("ok");
  });

  it("nets wins against losses in period loss limits", () => {
    const profile = onProfile();
    profile.lossLimits.week = { on: true, value: 200, unit: "amount" };
    // 3 losses (−$33) + 1 win (+$30) = −$3 net → used = 3
    const trades = [
      trade(-11, "loss", new Date("2024-06-12T10:00:00Z")),
      trade(-11, "loss", new Date("2024-06-13T10:00:00Z")),
      trade(-11, "loss", new Date("2024-06-14T10:00:00Z")),
      trade(30, "win", new Date("2024-06-14T14:00:00Z")),
    ];
    const r = computeAccountRisk("a1", toHours(trades), 1000, profile, 0, NOW);
    const w = r.limits.find((l) => l.key === "week")!;
    expect(w.used).toBe(3); // net loss = $3, not $33
    expect(w.state).toBe("ok");
  });

  it("nets wins against losses in month loss limit", () => {
    const profile = onProfile();
    profile.lossLimits.month = { on: true, value: 500, unit: "amount" };
    // 3 losses (−$100, −$100, −$100) + 1 win (+$250) = −$50 net → used = 50.
    // Все даты строго ДО NOW: закрытая сделка не может лежать в будущем, и окно
    // периода ограничено текущим моментом.
    const trades = [
      trade(-100, "loss", new Date("2024-06-05T10:00:00Z")),
      trade(-100, "loss", new Date("2024-06-10T10:00:00Z")),
      trade(-100, "loss", new Date("2024-06-12T10:00:00Z")),
      trade(250, "win", new Date("2024-06-14T14:00:00Z")),
    ];
    const r = computeAccountRisk("a1", toHours(trades), 1000, profile, 0, NOW);
    const m = r.limits.find((l) => l.key === "month")!;
    expect(m.used).toBe(50); // net loss = $50, not $300
    expect(m.state).toBe("ok");
  });

  it("nets wins against losses in year loss limit", () => {
    const profile = onProfile();
    profile.lossLimits.year = { on: true, value: 10000, unit: "amount" };
    // 3 losses (−$1000) + 1 win (+$2500) = −$500 net → used = 500 (даты до NOW).
    const trades = [
      trade(-1000, "loss", new Date("2024-02-10T10:00:00Z")),
      trade(-1000, "loss", new Date("2024-03-15T10:00:00Z")),
      trade(-1000, "loss", new Date("2024-04-20T10:00:00Z")),
      trade(2500, "win", new Date("2024-05-10T14:00:00Z")),
    ];
    const r = computeAccountRisk("a1", toHours(trades), 1000, profile, 0, NOW);
    const y = r.limits.find((l) => l.key === "year")!;
    expect(y.used).toBe(500); // net loss = $500, not $3000
    expect(y.state).toBe("ok");
  });

  it("skips a pct loss limit when balance is unknown", () => {
    const profile = onProfile();
    profile.lossLimits.month = { on: true, value: 10, unit: "pct" };
    const trades = [trade(-60, "loss", may(2))];
    const r = computeAccountRisk("a1", toHours(trades), null, profile, 0, NOW);
    expect(r.limits.find((l) => l.key === "month")).toBeUndefined();
  });

  it("aggregates the worst state across limits", () => {
    const profile = onProfile();
    profile.maxStopsPerDay = 5;
    profile.lossLimits.month = { on: true, value: 10000, unit: "amount" };
    const trades = [trade(-100, "loss", today(9)), trade(-100, "loss", today(10)), trade(-100, "loss", today(11)), trade(-100, "loss", today(12))];
    const r = computeAccountRisk("a1", toHours(trades), 1000, profile, 0, NOW);
    // stops: 4 used / 5 → warning; month: 400/10000 → ok → aggregate = warning
    expect(r.state).toBe("warning");
  });
});

// R-мультипликатор: сколько «рисков» принесла сделка. Считается либо от суммы
// риска из риск-менеджера, либо от расстояния до стопа.
describe("tradeRR / stopDistanceRR", () => {
  const long = {
    accountId: "acc-1",
    side: "long" as const,
    entryPrice: 100,
    exitPrice: 110,
    fees: 0,
    qty: 1,
    netPnl: 10,
  };

  it("has no R without a stop-loss and without a risk profile", () => {
    expect(stopDistanceRR(long, null)).toBeNull();
    expect(tradeRR(long, null, {}, 10000)).toBeNull();
  });

  it("has no R when the stop sits exactly at the entry", () => {
    expect(stopDistanceRR(long, 100)).toBeNull();
  });

  // MT4/MT5 отдают S/L на момент ЗАКРЫТИЯ: если стоп был подтянут в безубыток,
  // в колонку попадает он. Считаем ровно по тому стопу, что указан, — правило
  // трейдера: «есть стоп — считаем, нет стопа — R не заполняем». Реальные
  // строки из ReportHistory (XAUUSD, GerchikCo-MT5, 21.08.2026).
  describe("стоп из форекс-отчёта", () => {
    it("считает R по указанному стопу, даже если он подтянут в безубыток", () => {
      // Шорт 4594.21 → 4582.73, стоп 4594.25: риск 0.04 на движение 11.48.
      const trade = { ...long, side: "short" as const, entryPrice: 4594.21, exitPrice: 4582.73, qty: 4, netPnl: 45.52 };
      expect(stopDistanceRR(trade, 4594.25)).toBeCloseTo(287, 0);
    });

    it("считает R по настоящему стопу той же сессии", () => {
      // Шорт 4594.66 → 4602.55, стоп 4602.55 сработал: ровно −1R минус комиссия.
      const trade = { ...long, side: "short" as const, entryPrice: 4594.66, exitPrice: 4602.55, qty: 2, fees: 0.2, netPnl: -15.98 };
      expect(stopDistanceRR(trade, 4602.55)).toBeCloseTo(-1.01, 2);
    });

    it("не заполняет R, когда стопа нет", () => {
      const trade = { ...long, entryPrice: 4585.74, exitPrice: 4593.58, qty: 2, netPnl: 15.49 };
      expect(stopDistanceRR(trade, null)).toBeNull();
    });
  });

  it("measures the move in stop distances for a long", () => {
    // Стоп в 5 пунктах, прошли 10 → 2R.
    expect(stopDistanceRR(long, 95)).toBe(2);
  });

  it("measures the move in stop distances for a short", () => {
    const short = { ...long, side: "short" as const, exitPrice: 90, netPnl: 10 };
    expect(stopDistanceRR(short, 105)).toBe(2);
  });

  it("subtracts fees expressed in the same R units", () => {
    // Комиссия 1 при 1R = 5 на единицу объёма → минус 0.2R.
    expect(stopDistanceRR({ ...long, fees: 1 }, 95)).toBeCloseTo(1.8, 9);
  });

  it("prefers the risk-manager amount over the stop distance", () => {
    const profile = {
      ...defaultRiskProfile(),
      enabled: true,
      riskPerTrade: { on: true, value: 100, unit: "amount" as const },
    };
    // Риск 100 на сделку, заработали 10 → 0.1R, независимо от стопа.
    expect(tradeRR(long, 95, { "acc-1": profile }, 10000)).toBeCloseTo(0.1, 9);
  });

  it("falls back to the default profile of the user", () => {
    const profile = {
      ...defaultRiskProfile(),
      enabled: true,
      riskPerTrade: { on: true, value: 1, unit: "pct" as const },
    };
    // 1% от 10000 = 100 → те же 0.1R для счёта без своего профиля.
    expect(tradeRR(long, null, { "": profile }, 10000)).toBeCloseTo(0.1, 9);
  });

  it("falls back to the stop distance when the profile risk is unusable", () => {
    const off = { ...defaultRiskProfile(), enabled: true };
    expect(tradeRR(long, 95, { "acc-1": off }, 10000)).toBe(2);
  });
});
