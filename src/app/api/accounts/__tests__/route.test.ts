import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/exchanges", () => ({
  SUPPORTED_EXCHANGES: { binance: { needsPassphrase: false } },
  isExchangeId: vi.fn(() => true),
}));
vi.mock("@/lib/statsCache", () => ({ bumpStatsVersion: vi.fn() }));
vi.mock("@/lib/crypto", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ""),
  maskSecret: (s: string) => s.slice(0, 2) + "***",
}));

import {
  asGuest,
  asUser,
  mockGetAuthUser,
  mockPrisma,
  mockExchangeToggle,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST } from "@/app/api/accounts/route";

const base = "https://example.com/api/accounts";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockPrisma.exchangeAccount.findMany.mockReset();
  mockPrisma.exchangeAccount.create.mockReset();
  mockExchangeToggle.isExchangeEnabled.mockReset();
  mockExchangeToggle.isExchangeEnabled.mockResolvedValue(true);
});

describe("GET /api/accounts", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns accounts for user", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([
      {
        id: "a1",
        exchange: "binance",
        label: "Main",
        source: "exchange",
        accountCurrency: null,
        marketType: "spot",
        demoTrading: false,
        balance: null,
        capital: null,
        apiKey: null,
        lastSyncAt: null,
        syncStatus: "idle",
        syncError: null,
        syncPhase: null,
        syncCursor: 0,
        syncTotal: 0,
        syncImported: 0,
        fullSyncAt: null,
        autoSync: true,
        syncIntervalMinutes: 60,
        createdAt: new Date(),
        _count: { fills: 0, importedTrades: 0 },
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].id).toBe("a1");
  });
});

describe("POST /api/accounts", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ exchange: "binance", label: "Main", apiKey: "k", apiSecret: "s" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when exchange disabled", async () => {
    asUser();
    mockExchangeToggle.isExchangeEnabled.mockResolvedValueOnce(false);
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ exchange: "binance", label: "Main", apiKey: "k", apiSecret: "s" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("creates an exchange account", async () => {
    asUser();
    mockPrisma.exchangeAccount.create.mockResolvedValue({ id: "a1" });
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ exchange: "binance", label: "Main", apiKey: "k", apiSecret: "s" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("a1");
  });

  it("creates an mt4 account without keys", async () => {
    asUser();
    mockPrisma.exchangeAccount.create.mockResolvedValue({ id: "m1" });
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ exchange: "mt4", source: "mt4", label: "MT4", accountCurrency: "USD" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("m1");
  });
});
