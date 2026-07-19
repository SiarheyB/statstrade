import { describe, it, expect } from "vitest";
import {
  defaultRiskProfile,
  parseRiskProfile,
  serializeLossLimits,
  serializeRiskPerTrade,
  riskPerTradeAmount,
  computeAccountRisk,
  type RiskTrade,
} from "@/lib/risk";

const NOW = new Date("2024-06-15T12:00:00Z");
const today = (h: number) => new Date(`2024-06-15T${String(h).padStart(2, "0")}:00:00Z`);
const may = (d: number) => new Date(`2024-05-${String(d).padStart(2, "0")}T10:00:00Z`);

function trade(netPnl: number, result: string, exitTime: Date, accountId = "a1"): RiskTrade {
  return { accountId, netPnl, exitTime, result };
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
    const r = computeAccountRisk("a1", [], 1000, defaultRiskProfile(), NOW);
    expect(r.enabled).toBe(false);
    expect(r.state).toBe("off");
    expect(r.limits).toEqual([]);
  });

  it("reports ok with no configured limits", () => {
    const r = computeAccountRisk("a1", [], 1000, onProfile(), NOW);
    expect(r.state).toBe("ok");
    expect(r.limits).toEqual([]);
  });

  it("counts net stops (wins offset losses) without 1R", () => {
    const profile = onProfile();
    profile.maxStopsPerDay = 3;
    const trades = [trade(-100, "loss", today(9)), trade(-100, "loss", today(10)), trade(100, "win", today(11))];
    const r = computeAccountRisk("a1", trades, 1000, profile, NOW);
    const stops = r.limits.find((l) => l.key === "stops")!;
    expect(stops.used).toBe(1); // 2 losses − 1 win
    expect(stops.state).toBe("ok");
    expect(stops.pct).toBeCloseTo(1 / 3);
  });

  it("flags breached when net stops reach the limit", () => {
    const profile = onProfile();
    profile.maxStopsPerDay = 2;
    const trades = [trade(-100, "loss", today(9)), trade(-100, "loss", today(10))];
    const r = computeAccountRisk("a1", trades, 1000, profile, NOW);
    expect(r.limits.find((l) => l.key === "stops")!.state).toBe("breached");
  });

  it("flags warning at ≥80% of the stop limit", () => {
    const profile = onProfile();
    profile.maxStopsPerDay = 5;
    const trades = [trade(-100, "loss", today(9)), trade(-100, "loss", today(10)), trade(-100, "loss", today(11)), trade(-100, "loss", today(12))];
    const r = computeAccountRisk("a1", trades, 1000, profile, NOW);
    expect(r.limits.find((l) => l.key === "stops")!.state).toBe("warning");
  });

  it("nets stops by R-multiple when 1R is configured", () => {
    const profile = onProfile();
    profile.maxStopsPerDay = 3;
    profile.riskPerTrade = { on: true, value: 100, unit: "amount" };
    // 2 stops (−1R each) + 1 take (+3R) → net profit → 0 stops used.
    const trades = [trade(-100, "loss", today(9)), trade(-100, "loss", today(10)), trade(300, "win", today(11))];
    const r = computeAccountRisk("a1", trades, 1000, profile, NOW);
    expect(r.limits.find((l) => l.key === "stops")!.used).toBe(0);
  });

  it("evaluates a percentage loss limit against balance", () => {
    const profile = onProfile();
    profile.lossLimits.month = { on: true, value: 10, unit: "pct" };
    const trades = [
      trade(-60, "loss", new Date("2024-06-02T10:00:00Z")),
      trade(-60, "loss", new Date("2024-06-10T10:00:00Z")),
    ]; // 120 loss in June
    const r = computeAccountRisk("a1", trades, 1000, profile, NOW); // limit = 100
    const m = r.limits.find((l) => l.key === "month")!;
    expect(m.limit).toBe(100);
    expect(m.used).toBe(120);
    expect(m.state).toBe("breached");
  });

  it("evaluates an absolute loss limit without balance", () => {
    const profile = onProfile();
    profile.lossLimits.day = { on: true, value: 200, unit: "amount" };
    const trades = [trade(-90, "loss", today(9))];
    const r = computeAccountRisk("a1", trades, null, profile, NOW); // pct would need balance; amount doesn't
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
    const r = computeAccountRisk("a1", trades, 1000, profile, NOW);
    const w = r.limits.find((l) => l.key === "week")!;
    expect(w.used).toBe(3); // net loss = $3, not $33
    expect(w.state).toBe("ok");
  });

  it("nets wins against losses in month loss limit", () => {
    const profile = onProfile();
    profile.lossLimits.month = { on: true, value: 500, unit: "amount" };
    // 3 losses (−$100, −$100, −$100) + 1 win (+$250) = −$50 net → used = 50
    const trades = [
      trade(-100, "loss", new Date("2024-06-05T10:00:00Z")),
      trade(-100, "loss", new Date("2024-06-12T10:00:00Z")),
      trade(-100, "loss", new Date("2024-06-19T10:00:00Z")),
      trade(250, "win", new Date("2024-06-20T14:00:00Z")),
    ];
    const r = computeAccountRisk("a1", trades, 1000, profile, NOW);
    const m = r.limits.find((l) => l.key === "month")!;
    expect(m.used).toBe(50); // net loss = $50, not $300
    expect(m.state).toBe("ok");
  });

  it("nets wins against losses in year loss limit", () => {
    const profile = onProfile();
    profile.lossLimits.year = { on: true, value: 10000, unit: "amount" };
    // 3 losses (−$1000) + 1 win (+$2500) = −$500 net → used = 500
    const trades = [
      trade(-1000, "loss", new Date("2024-02-10T10:00:00Z")),
      trade(-1000, "loss", new Date("2024-05-15T10:00:00Z")),
      trade(-1000, "loss", new Date("2024-08-20T10:00:00Z")),
      trade(2500, "win", new Date("2024-11-10T14:00:00Z")),
    ];
    const r = computeAccountRisk("a1", trades, 1000, profile, NOW);
    const y = r.limits.find((l) => l.key === "year")!;
    expect(y.used).toBe(500); // net loss = $500, not $3000
    expect(y.state).toBe("ok");
  });

  it("skips a pct loss limit when balance is unknown", () => {
    const profile = onProfile();
    profile.lossLimits.month = { on: true, value: 10, unit: "pct" };
    const trades = [trade(-60, "loss", may(2))];
    const r = computeAccountRisk("a1", trades, null, profile, NOW);
    expect(r.limits.find((l) => l.key === "month")).toBeUndefined();
  });

  it("aggregates the worst state across limits", () => {
    const profile = onProfile();
    profile.maxStopsPerDay = 5;
    profile.lossLimits.month = { on: true, value: 10000, unit: "amount" };
    const trades = [trade(-100, "loss", today(9)), trade(-100, "loss", today(10)), trade(-100, "loss", today(11)), trade(-100, "loss", today(12))];
    const r = computeAccountRisk("a1", trades, 1000, profile, NOW);
    // stops: 4 used / 5 → warning; month: 400/10000 → ok → aggregate = warning
    expect(r.state).toBe("warning");
  });
});
