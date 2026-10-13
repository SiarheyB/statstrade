import { describe, it, expect } from "vitest";
import { hashPushToken, newPushToken, pushSchema, pushTokenFromRequest, toParsedTrades } from "@/lib/mt/push";

const pos = {
  ticket: "32647659",
  symbol: "NZDUSD",
  side: "sell" as const,
  lots: 0.06,
  openTime: "2026.10.06 17:25:46",
  closeTime: "2026.10.07 10:34:49",
  openPrice: 0.56158,
  closePrice: 0.56056,
  sl: 0.56464,
  tp: 0,
  commission: -0.36,
  swap: 0.04,
  profit: 6.12,
};

describe("push token", () => {
  it("issues distinct tokens with a stable hash", () => {
    const a = newPushToken();
    const b = newPushToken();
    expect(a).toMatch(/^tsk_[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
    expect(hashPushToken(a)).toBe(hashPushToken(a));
    expect(hashPushToken(a)).not.toBe(hashPushToken(b));
  });

  it("reads only a Bearer tsk_ token", () => {
    const t = newPushToken();
    const req = (h?: string) => new Request("https://x/api/mt/push", { headers: h ? { authorization: h } : {} });
    expect(pushTokenFromRequest(req(`Bearer ${t}`))).toBe(t);
    expect(pushTokenFromRequest(req())).toBeNull();
    expect(pushTokenFromRequest(req("Bearer something-else"))).toBeNull();
    expect(pushTokenFromRequest(req(t))).toBeNull();
  });
});

describe("push payload", () => {
  it("maps positions like the report parser (server time, signed fees, no zero SL/TP)", () => {
    const p = pushSchema.parse({ v: 1, balance: 1000, positions: [pos] });
    const [t] = toParsedTrades(p);
    expect(t).toEqual({
      externalId: "32647659",
      symbol: "NZDUSD",
      side: "short",
      lots: 0.06,
      entryTime: new Date(Date.UTC(2026, 9, 6, 17, 25, 46)),
      exitTime: new Date(Date.UTC(2026, 9, 7, 10, 34, 49)),
      entryPrice: 0.56158,
      exitPrice: 0.56056,
      stopLoss: 0.56464,
      takeProfit: null,
      commission: -0.36,
      swap: 0.04,
      grossProfit: 6.12,
      comment: null,
    });
  });

  it("accepts numeric tickets and drops duplicates", () => {
    const p = pushSchema.parse({ v: 1, positions: [{ ...pos, ticket: 7 }, { ...pos, ticket: "7" }] });
    expect(toParsedTrades(p)).toHaveLength(1);
  });

  it("rejects bad time, side and unknown version", () => {
    expect(pushSchema.safeParse({ v: 1, positions: [{ ...pos, openTime: "вчера" }] }).success).toBe(false);
    expect(pushSchema.safeParse({ v: 1, positions: [{ ...pos, side: "long" }] }).success).toBe(false);
    expect(pushSchema.safeParse({ v: 2, positions: [] }).success).toBe(false);
  });
});
