import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/risk", () => ({
  parseRiskProfile: vi.fn(() => ({ enabled: false, maxStopsPerDay: null })),
  serializeLossLimits: vi.fn(() => ({})),
  serializeRiskPerTrade: vi.fn(() => ({})),
  defaultRiskProfile: vi.fn(() => ({ enabled: false, maxStopsPerDay: null })),
}));

import {
  asGuest,
  asUser,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, PUT } from "@/app/api/risk/settings/route";

const base = "https://example.com/api/risk/settings";

const profile = {
  enabled: true,
  maxStopsPerDay: 3,
  riskPerTrade: { on: true, value: 1, unit: "pct" },
  lossLimits: {
    day: { on: false, value: 0, unit: "amount" },
    week: { on: false, value: 0, unit: "amount" },
    month: { on: false, value: 0, unit: "amount" },
    year: { on: false, value: 0, unit: "amount" },
  },
};

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockPrisma.riskProfile.findMany.mockReset();
  mockPrisma.riskProfile.upsert.mockReset();
  mockPrisma.riskProfile.deleteMany.mockReset();
});

describe("GET /api/risk/settings", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns profiles for user", async () => {
    asUser();
    mockPrisma.riskProfile.findMany.mockResolvedValue([
      { accountId: "a1", enabled: true, maxStopsPerDay: 3, riskPerTrade: {}, lossLimits: {} },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles[""]).toBeDefined();
  });
});

describe("PUT /api/risk/settings", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await PUT(
      new Request(base, { method: "PUT", body: JSON.stringify({ profiles: { "": profile } }) }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid body", async () => {
    asUser();
    const res = await PUT(
      new Request(base, { method: "PUT", body: JSON.stringify({ profiles: "nope" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("upserts a profile", async () => {
    asUser();
    mockPrisma.riskProfile.upsert.mockResolvedValue({});
    const res = await PUT(
      new Request(base, { method: "PUT", body: JSON.stringify({ profiles: { "": profile } }) }),
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.riskProfile.upsert).toHaveBeenCalled();
  });

  it("deletes a profile when null", async () => {
    asUser();
    mockPrisma.riskProfile.deleteMany.mockResolvedValue({ count: 1 });
    const res = await PUT(
      new Request(base, { method: "PUT", body: JSON.stringify({ profiles: { a1: null } }) }),
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.riskProfile.deleteMany).toHaveBeenCalled();
  });
});
