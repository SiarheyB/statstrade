import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/risk", () => ({
  parseRiskProfile: vi.fn(() => ({ enabled: false, maxStopsPerDay: null })),
  serializeLossLimits: vi.fn(() => ({})),
  serializeRiskPerTrade: vi.fn(() => ({})),
  defaultRiskProfile: vi.fn(() => ({ enabled: false, maxStopsPerDay: null })),
  riskPerTradeAmount: vi.fn(() => null),
  // Нужен ли комментарий к правке риска — настоящее правило проверено в
  // lib/__tests__/risk.test.ts; тут мок, чтобы включать и выключать ветку.
  riskChangeNeedsComment: vi.fn(() => false),
}));

import { riskChangeNeedsComment } from "@/lib/risk";
const needsComment = vi.mocked(riskChangeNeedsComment);

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
  // PUT читает прежние профили, чтобы понять, менялся ли риск.
  mockPrisma.riskProfile.findMany.mockResolvedValue([]);
  mockPrisma.riskProfile.upsert.mockReset();
  mockPrisma.riskProfile.deleteMany.mockReset();
  needsComment.mockReset();
  needsComment.mockReturnValue(false);
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

  it("не сохраняет изменение риска без комментария", async () => {
    asUser();
    needsComment.mockReturnValue(true);
    mockPrisma.riskProfile.upsert.mockResolvedValue({});
    const res = await PUT(
      new Request(base, { method: "PUT", body: JSON.stringify({ profiles: { "": profile } }) }),
    );
    expect(res.status).toBe(400);
    // Ничего не записано: правило не должно обходиться запросом мимо формы.
    expect(mockPrisma.riskProfile.upsert).not.toHaveBeenCalled();
  });

  it("сохраняет изменение риска с комментарием", async () => {
    asUser();
    needsComment.mockReturnValue(true);
    mockPrisma.riskProfile.upsert.mockResolvedValue({});
    const res = await PUT(
      new Request(base, {
        method: "PUT",
        body: JSON.stringify({ profiles: { "": profile }, comment: "Серия стопов, режу риск" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.riskProfile.upsert).toHaveBeenCalled();
  });

  it("пробелы за комментарий не считаются", async () => {
    asUser();
    needsComment.mockReturnValue(true);
    const res = await PUT(
      new Request(base, {
        method: "PUT",
        body: JSON.stringify({ profiles: { "": profile }, comment: "   " }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

