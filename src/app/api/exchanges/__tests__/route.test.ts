import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/exchanges/route";

vi.mock("@/lib/exchangeToggle", () => ({
  getEnabledExchangeMetas: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  unauthorized: vi.fn(),
  serverError: vi.fn(),
}));

const base = "https://example.com/api/exchanges";

describe("GET /api/exchanges", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(require("@/lib/exchangeToggle").getEnabledExchangeMetas).mockReset();
    vi.fn().mockReturnValue([
      { id: "bybit", label: "Bybit" },
      { id: "binance", label: "Binance" },
      { id: "okx", label: "OKX" },
    ]);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns enabled exchanges for authenticated user", async () => {
    asUser();
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exchanges).toEqual([
      { id: "bybit", label: "Bybit" },
      { id: "binance", label: "Binance" },
      { id: "okx", label: "OKX" },
    ]);
  });
});