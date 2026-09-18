import { describe, it, expect } from "vitest";
import { buildRiskResolver, type RiskVersion } from "@/lib/riskHistory";
import { defaultRiskProfile, tradeRR, type RiskProfileData } from "@/lib/risk";

const profileWith = (value: number): RiskProfileData => ({
  ...defaultRiskProfile(),
  enabled: true,
  riskPerTrade: { on: true, value, unit: "pct" },
});

const v = (accountId: string, iso: string, amount: number | null): RiskVersion => ({
  accountId,
  effectiveFrom: new Date(iso),
  amount,
});

describe("buildRiskResolver", () => {
  it("returns the amount in force at the trade's close, not the current one", () => {
    const riskAt = buildRiskResolver(
      [v("acc", "1970-01-01T00:00:00Z", 11), v("acc", "2026-09-18T09:00:00Z", 22)],
      { "": profileWith(1) },
      2200,
    );
    // Сделка до перевода риска — по старому 1R.
    expect(riskAt("acc", new Date("2026-09-17T22:00:00Z"))).toBe(11);
    // После — по новому.
    expect(riskAt("acc", new Date("2026-09-18T12:00:00Z"))).toBe(22);
  });

  it("treats effectiveFrom as inclusive", () => {
    const riskAt = buildRiskResolver([v("acc", "2026-09-18T09:00:00Z", 22)], {}, null);
    expect(riskAt("acc", new Date("2026-09-18T09:00:00Z"))).toBe(22);
  });

  it("falls back to the current profile for trades older than any version", () => {
    const riskAt = buildRiskResolver([v("acc", "2026-09-18T09:00:00Z", 22)], { "": profileWith(1) }, 2200);
    expect(riskAt("acc", new Date("2020-01-01T00:00:00Z"))).toBe(22);
  });

  it("uses the current profile when there is no history at all", () => {
    const riskAt = buildRiskResolver([], { "": profileWith(0.5) }, 2200);
    expect(riskAt("acc", new Date())).toBe(11);
  });

  it("a version with no amount means 1R was not set back then", () => {
    const riskAt = buildRiskResolver(
      [v("acc", "1970-01-01T00:00:00Z", null)],
      { "": profileWith(1) },
      2200,
    );
    expect(riskAt("acc", new Date("2026-01-01T00:00:00Z"))).toBeNull();
  });

  it("prefers the account's own versions over the shared ones", () => {
    const riskAt = buildRiskResolver(
      [v("acc", "1970-01-01T00:00:00Z", 11), v("", "1970-01-01T00:00:00Z", 99)],
      {},
      null,
    );
    expect(riskAt("acc", new Date("2026-01-01T00:00:00Z"))).toBe(11);
  });
});

describe("tradeRR with a historical 1R", () => {
  const tr = {
    accountId: "acc",
    side: "short",
    entryPrice: 0.2487,
    exitPrice: 0.2518,
    fees: 1.4,
    qty: 7414,
    netPnl: -24.38,
  };

  it("keeps the R of a past trade when the profile risk is doubled", () => {
    // Профиль уже переведён на 1% (1R = 22), но сделка закрыта при 0.5% (1R = 11).
    const profiles = { "": profileWith(1) };
    expect(tradeRR(tr, null, profiles, 2200)).toBeCloseTo(-1.108, 3); // как было: по текущему профилю
    expect(tradeRR(tr, null, profiles, 2200, 11)).toBeCloseTo(-2.216, 3); // по риску той поры
  });

  it("falls back to the stop-distance model when 1R was not set then", () => {
    expect(tradeRR(tr, null, { "": profileWith(1) }, 2200, null)).toBeNull();
  });
});
