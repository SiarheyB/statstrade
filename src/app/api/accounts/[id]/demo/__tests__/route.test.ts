import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/statsCache", () => ({ bumpStatsVersion: vi.fn() }));
vi.mock("@/lib/demo", () => ({
  seedDemoData: vi.fn(async () => 10),
}));

import {
  asGuest,
  asUser,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { seedDemoData } from "@/lib/demo";
import { POST } from "@/app/api/accounts/[id]/demo/route";

const base = "https://example.com/api/accounts/a1/demo";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockPrisma.exchangeAccount.findFirst.mockReset();
  mockPrisma.exchangeAccount.update.mockReset();
  (seedDemoData as any).mockReset();
  (seedDemoData as any).mockResolvedValue(10);
});

describe("POST /api/accounts/[id]/demo", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(new Request(base, { method: "POST" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when account not found", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue(null);
    const res = await POST(new Request(base, { method: "POST" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
  });

  it("seeds demo data", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1", exchange: "binance" });
    mockPrisma.exchangeAccount.update.mockResolvedValue({});
    const res = await POST(new Request(base, { method: "POST" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(10);
  });
});
