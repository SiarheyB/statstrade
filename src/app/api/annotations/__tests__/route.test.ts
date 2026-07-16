import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { PUT } from "@/app/api/annotations/route";

vi.mock("@/lib/statsCache", () => ({
  bumpStatsVersion: vi.fn(),
}));

// Augment shared prisma mock with the tradeAnnotation upsert the route calls.
mockPrisma.tradeAnnotation = {
  ...mockPrisma.tradeAnnotation,
  upsert: vi.fn().mockResolvedValue({}),
};

const base = "https://example.com/api/annotations";

const mockAnnotation = {
  userId: "u1",
  tradeKey: "trade-1",
  entryPoint: "breakout",
  entryType: "market",
  mistake: null,
  pattern: "double_top",
  stopLoss: 49000,
  note: "good entry",
};

describe("PUT /api/annotations", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.tradeAnnotation.upsert.mockResolvedValue(mockAnnotation as any);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await PUT(new Request(base, {
      method: "PUT",
      body: JSON.stringify({ tradeKey: "trade-1" }),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid body (missing tradeKey)", async () => {
    asUser();
    const res = await PUT(new Request(base, {
      method: "PUT",
      body: JSON.stringify({ entryPoint: "breakout" }),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on malformed JSON", async () => {
    asUser();
    const res = await PUT(new Request(base, {
      method: "PUT",
      body: "{not json",
    }));
    expect(res.status).toBe(400);
  });

  it("upserts annotation on valid body", async () => {
    asUser();
    const res = await PUT(new Request(base, {
      method: "PUT",
      body: JSON.stringify({
        tradeKey: "trade-1",
        entryPoint: "breakout",
        entryType: "market",
        pattern: "double_top",
        stopLoss: 49000,
        note: "good entry",
      }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tradeKey).toBe("trade-1");
    expect(body.entryPoint).toBe("breakout");
    expect(body.pattern).toBe("double_top");
    expect(mockPrisma.tradeAnnotation.upsert).toHaveBeenCalledOnce();
  });
});
