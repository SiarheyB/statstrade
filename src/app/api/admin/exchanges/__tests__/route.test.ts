import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asGuest,
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockGetAuthUser,
  mockRecordAudit,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, PUT } from "@/app/api/admin/exchanges/route";

vi.mock("@/lib/exchanges", () => ({
  createExchange: vi.fn(),
  fetchBalanceUsdt: vi.fn(),
  isExchangeId: vi.fn(() => true),
  normalizeFill: vi.fn(),
}));

const base = "https://example.com/api/admin/exchanges";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockGetAdminSession.mockReset();
  mockRecordAudit.mockReset();
  mockPrisma.exchangeToggle.upsert.mockResolvedValue({});
});

describe("GET /api/admin/exchanges", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns exchanges list for admin", async () => {
    asAdmin();
    asGuest();
    const { getAllExchangeToggles } = await import("@/lib/exchangeToggle");
    vi.mocked(getAllExchangeToggles).mockResolvedValueOnce([{ exchange: "bybit", enabled: true, demoEnabled: null }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.exchanges)).toBe(true);
  });
});

describe("PUT /api/admin/exchanges", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await PUT(new Request(base, { method: "PUT", body: JSON.stringify({ exchange: "bybit", enabled: true }) }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when neither enabled nor demoEnabled", async () => {
    asAdmin();
    asGuest();
    const res = await PUT(new Request(base, { method: "PUT", body: JSON.stringify({ exchange: "bybit" }) }));
    expect(res.status).toBe(400);
  });

  it("upserts a toggle for admin", async () => {
    asAdmin();
    asGuest();
    const { isExchangeId } = await import("@/lib/exchanges");
    vi.mocked(isExchangeId).mockReturnValue(true);
    const { getAllExchangeToggles } = await import("@/lib/exchangeToggle");
    vi.mocked(getAllExchangeToggles).mockResolvedValueOnce([{ exchange: "bybit", enabled: false, demoEnabled: null }]);
    const res = await PUT(new Request(base, { method: "PUT", body: JSON.stringify({ exchange: "bybit", enabled: false }) }));
    expect(res.status).toBe(200);
    expect(mockPrisma.exchangeToggle.upsert).toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalled();
  });
});
