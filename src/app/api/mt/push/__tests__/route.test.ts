import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mt/applyImport", () => ({ applyImport: vi.fn() }));

import { mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { applyImport } from "@/lib/mt/applyImport";
import { hashPushToken, newPushToken } from "@/lib/mt/push";
import { POST } from "@/app/api/mt/push/route";

const token = newPushToken();
const account = { id: "a1", userId: "u1", source: "mt5", accountCurrency: "USD" };
const pos = {
  ticket: 1, symbol: "EURUSD", side: "buy", lots: 0.1,
  openTime: "2026.10.06 10:00:00", closeTime: "2026.10.06 11:00:00",
  openPrice: 1.1, closePrice: 1.101, profit: 10,
};

function req(body: unknown, auth: string | null = `Bearer ${token}`) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return new Request("https://tradingstat.ru/api/mt/push", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  mockPrisma.exchangeAccount.findUnique.mockReset();
  (applyImport as any).mockReset();
});

describe("POST /api/mt/push", () => {
  it("401 without a token", async () => {
    const res = await POST(req({ v: 1, positions: [] }, null));
    expect(res.status).toBe(401);
    expect(mockPrisma.exchangeAccount.findUnique).not.toHaveBeenCalled();
  });

  it("401 for an unknown or revoked token, looked up by hash only", async () => {
    mockPrisma.exchangeAccount.findUnique.mockResolvedValue(null);
    const res = await POST(req({ v: 1, positions: [] }));
    expect(res.status).toBe(401);
    expect(mockPrisma.exchangeAccount.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pushTokenHash: hashPushToken(token) } }),
    );
  });

  it("400 for a non-MetaTrader account", async () => {
    mockPrisma.exchangeAccount.findUnique.mockResolvedValue({ ...account, source: "exchange" });
    const res = await POST(req({ v: 1, positions: [] }));
    expect(res.status).toBe(400);
  });

  it("400 for an MT4 account: the advisor is MQL5-only", async () => {
    mockPrisma.exchangeAccount.findUnique.mockResolvedValue({ ...account, source: "mt4" });
    const res = await POST(req({ v: 1, positions: [] }));
    expect(res.status).toBe(400);
    expect(applyImport).not.toHaveBeenCalled();
  });

  it("400 for a malformed payload", async () => {
    mockPrisma.exchangeAccount.findUnique.mockResolvedValue(account);
    const res = await POST(req({ v: 1, positions: [{ ...pos, side: "x" }] }));
    expect(res.status).toBe(400);
    expect(applyImport).not.toHaveBeenCalled();
  });

  it("imports into the token's account through the shared pipeline", async () => {
    mockPrisma.exchangeAccount.findUnique.mockResolvedValue(account);
    (applyImport as any).mockResolvedValue({ imported: 1, updated: 0, skipped: 0, parsed: 1, batch: "b" });
    const res = await POST(req({ v: 1, balance: 1010, positions: [pos] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: 1, updated: 0, skipped: 0, parsed: 1 });
    const call = (applyImport as any).mock.calls[0][0];
    expect(call.account).toEqual(account);
    expect(call.userId).toBe("u1");
    expect(call.balance).toBe(1010);
    expect(call.push).toBe(true);
    expect(call.trades[0].externalId).toBe("1");
  });
});
