import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/statsCache", () => ({ bumpStatsVersion: vi.fn() }));
vi.mock("@/lib/demo", () => ({
  seedDemoData: vi.fn(async () => 10),
  removeDemoData: vi.fn(async () => 10),
  countRealFills: vi.fn(async () => 0),
  DEMO_BALANCE: 10000,
}));

import {
  asGuest,
  asUser,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { seedDemoData, removeDemoData, countRealFills } from "@/lib/demo";
import { POST, DELETE } from "@/app/api/accounts/[id]/demo/route";

const base = "https://example.com/api/accounts/a1/demo";
const params = { params: Promise.resolve({ id: "a1" }) };

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockPrisma.exchangeAccount.findFirst.mockReset();
  mockPrisma.exchangeAccount.update.mockReset();
  (seedDemoData as any).mockReset();
  (seedDemoData as any).mockResolvedValue(10);
  (removeDemoData as any).mockReset();
  (removeDemoData as any).mockResolvedValue(10);
  (countRealFills as any).mockReset();
  (countRealFills as any).mockResolvedValue(0);
});

describe("POST /api/accounts/[id]/demo", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(new Request(base, { method: "POST" }), params);
    expect(res.status).toBe(401);
  });

  it("returns 400 when account not found", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue(null);
    const res = await POST(new Request(base, { method: "POST" }), params);
    expect(res.status).toBe(400);
  });

  it("seeds demo data", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1", exchange: "binance" });
    mockPrisma.exchangeAccount.update.mockResolvedValue({});
    const res = await POST(new Request(base, { method: "POST" }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(10);
  });

  it("отказывает (409), когда на счёте есть реальные сделки", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1", exchange: "binance" });
    (countRealFills as any).mockResolvedValue(584);
    const res = await POST(new Request(base, { method: "POST" }), params);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("has_real_fills");
    expect(body.realFills).toBe(584);
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it("с ?force=1 грузит демо и поверх реальных сделок", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1", exchange: "binance" });
    mockPrisma.exchangeAccount.update.mockResolvedValue({});
    (countRealFills as any).mockResolvedValue(584);
    const res = await POST(new Request(`${base}?force=1`, { method: "POST" }), params);
    expect(res.status).toBe(200);
    expect(seedDemoData).toHaveBeenCalled();
  });
});

describe("DELETE /api/accounts/[id]/demo", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await DELETE(new Request(base, { method: "DELETE" }), params);
    expect(res.status).toBe(401);
  });

  it("сносит демо-данные и отдаёт число удалённых", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1", balance: 10000 });
    mockPrisma.exchangeAccount.update.mockResolvedValue({});
    const res = await DELETE(new Request(base, { method: "DELETE" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 10 });
    expect(removeDemoData).toHaveBeenCalledWith("a1", expect.any(String));
    // Демо-депозит снят: реальных филлов не осталось.
    expect(mockPrisma.exchangeAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ balance: null }) }),
    );
  });

  it("не трогает баланс, если он не демо-шный", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1", balance: 2500 });
    mockPrisma.exchangeAccount.update.mockResolvedValue({});
    await DELETE(new Request(base, { method: "DELETE" }), params);
    const arg = mockPrisma.exchangeAccount.update.mock.calls[0][0];
    expect(arg.data).not.toHaveProperty("balance");
  });
});
