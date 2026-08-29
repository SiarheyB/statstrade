import { describe, it, expect, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/trade-fills/route";

const base = "https://example.com/api/trade-fills";

const mockFill = {
  id: "f-1",
  accountId: "acc-1",
  symbol: "BTCUSDT",
  market: "spot" as const,
  side: "sell" as const,
  price: 50000,
  amount: 0.1,
  cost: 5000,
  realizedPnl: 100,
  timestamp: new Date("2024-01-01T12:00:00Z"),
};

const range = "from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z";

describe("GET /api/trade-fills", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.fill.findMany.mockReset().mockResolvedValue([mockFill as never]);
    // По умолчанию счёт принадлежит текущему пользователю.
    mockPrisma.exchangeAccount.findFirst.mockReset().mockResolvedValue({ id: "acc-1" });
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?accountId=acc-1&symbol=BTCUSDT&${range}`));
    expect(res.status).toBe(401);
  });

  it("returns 400 when required params are missing", async () => {
    asUser();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT`));
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid date range", async () => {
    asUser();
    const res = await GET(new Request(`${base}?accountId=acc-1&symbol=BTCUSDT&from=not-a-date&to=2024-01-02`));
    expect(res.status).toBe(400);
  });

  it("returns exit fills for a long trade", async () => {
    asUser();
    const res = await GET(new Request(`${base}?accountId=acc-1&symbol=BTCUSDT&${range}&side=long`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.fills)).toBe(true);
    expect(body.fills.length).toBe(1);
    // long → exit side "sell"
    expect(mockPrisma.fill.findMany.mock.calls[0][0].where.side).toBe("sell");
    expect(body.fills[0].realizedPnl).toBe(100);
  });

  it("returns exit fills for a short trade", async () => {
    asUser();
    const res = await GET(new Request(`${base}?accountId=acc-1&symbol=BTCUSDT&${range}&side=short`));
    expect(res.status).toBe(200);
    // short → exit side "buy"
    expect(mockPrisma.fill.findMany.mock.calls[0][0].where.side).toBe("buy");
  });

  // --- Принадлежность счёта -------------------------------------------------
  // accountId приходит из query. Пока владельца не проверяли, любой
  // авторизованный пользователь читал по чужому id цены, объёмы и
  // реализованный P&L чужих сделок.

  it("владение счётом проверяется ДО чтения филлов", async () => {
    asUser();
    await GET(new Request(`${base}?accountId=acc-1&symbol=BTCUSDT&${range}`));
    expect(mockPrisma.exchangeAccount.findFirst).toHaveBeenCalledWith({
      where: { id: "acc-1", userId: "u1" },
      select: { id: true },
    });
  });

  it("чужой счёт: 400 и НИ ОДНОГО филла из базы", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue(null); // счёт не наш
    const res = await GET(new Request(`${base}?accountId=someone-else&symbol=BTCUSDT&${range}`));
    expect(res.status).toBe(400);
    expect(mockPrisma.fill.findMany).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.fills).toBeUndefined();
  });

  it("чужой и несуществующий счёт отвечают одинаково — id не перебрать", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue(null);
    const foreign = await GET(new Request(`${base}?accountId=foreign&symbol=BTCUSDT&${range}`));
    const missing = await GET(new Request(`${base}?accountId=nope&symbol=BTCUSDT&${range}`));
    expect(foreign.status).toBe(missing.status);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it("сбой базы не отдаёт наружу текст ошибки Prisma", async () => {
    asUser();
    mockPrisma.fill.findMany.mockRejectedValue(new Error('relation "Fill" does not exist'));
    const res = await GET(new Request(`${base}?accountId=acc-1&symbol=BTCUSDT&${range}`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("Fill");
  });
});
