import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn().mockResolvedValue({}),
  count: vi.fn().mockResolvedValue(0),
  fetchOHLCV: vi.fn(),
  getPublicExchange: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { trade: { findMany: mocks.findMany, update: mocks.update, count: mocks.count } },
}));
vi.mock("@/lib/exchanges", () => ({
  getPublicExchange: mocks.getPublicExchange,
}));

import { fillMissingMfe } from "@/lib/analytics/mfe";

const HOUR = 3600_000;
const T0 = Date.parse("2026-03-01T00:00:00Z");

function trade(over: Record<string, unknown> = {}) {
  return {
    id: "t1", exchange: "binance", symbol: "BTC/USDT", market: "swap", side: "long",
    entryPrice: 100, exitPrice: 110,
    entryTime: new Date(T0), exitTime: new Date(T0 + HOUR),
    ...over,
  };
}

// Свечи, охватывающие цены сделки: high 120, low 95.
// ВАЖНО: все должны попасть в окно, которое строит воркер вокруг сделки
// (entry−pad … exit+pad, pad = max(30% длительности, 30 мин)) — иначе после
// фильтрации их останется ≤2 и candlesLookReal справедливо откажется считать.
const MIN = 60_000;
function candles(): number[][] {
  return [
    [T0 - 10 * MIN, 100, 105, 98, 102],
    [T0 + 10 * MIN, 102, 120, 95, 110],
    [T0 + 30 * MIN, 110, 112, 105, 110],
    [T0 + 50 * MIN, 110, 111, 106, 108],
  ];
}

describe("fillMissingMfe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({});
    mocks.getPublicExchange.mockResolvedValue({
      has: { fetchOHLCV: true },
      fetchOHLCV: mocks.fetchOHLCV,
    });
    mocks.fetchOHLCV.mockResolvedValue(candles());
  });

  it("не ходит на биржу, когда очередь пуста", async () => {
    mocks.findMany.mockResolvedValue([]);
    const res = await fillMissingMfe();
    expect(res).toEqual({ picked: 0, filled: 0, failed: 0 });
    expect(mocks.getPublicExchange).not.toHaveBeenCalled();
  });

  it("берёт только несчитанные сделки, свежие первыми", async () => {
    mocks.findMany.mockResolvedValue([]);
    await fillMissingMfe({ limit: 10 });
    const args = mocks.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ mfeAt: null, mfeAttempts: { lt: 3 } });
    expect(args.orderBy).toEqual({ exitTime: "desc" });
    expect(args.take).toBe(10);
  });

  it("считает MFE/MAE и сохраняет результат", async () => {
    mocks.findMany.mockResolvedValue([trade()]);
    const res = await fillMissingMfe();
    expect(res.filled).toBe(1);

    const data = mocks.update.mock.calls[0][0].data;
    // long, вход 100: максимум 120 → MFE 20%, минимум 95 → MAE 5%.
    expect(data.mfePct).toBeCloseTo(20, 6);
    expect(data.maePct).toBeCloseTo(5, 6);
    // Реальный ход 10 из возможных 20 → забрали 50%.
    expect(data.capturedPct).toBeCloseTo(50, 6);
    expect(data.bestPrice).toBe(120);
    expect(data.mfeAt).toBeInstanceOf(Date);
  });

  it("для шорта берёт экстремумы в другую сторону", async () => {
    mocks.findMany.mockResolvedValue([trade({ side: "short", entryPrice: 110, exitPrice: 100 })]);
    await fillMissingMfe();
    const data = mocks.update.mock.calls[0][0].data;
    // short, вход 110: минимум 95 → MFE (110-95)/110, максимум 120 → MAE (120-110)/110.
    expect(data.mfePct).toBeCloseTo((15 / 110) * 100, 6);
    expect(data.maePct).toBeCloseTo((10 / 110) * 100, 6);
    expect(data.bestPrice).toBe(95);
  });

  it("не сохраняет цифры, когда свечи не совпадают с ценами сделки", async () => {
    // Цены сделки далеко за пределами свечей — данные не те (демо-сделка и т.п.).
    mocks.findMany.mockResolvedValue([trade({ entryPrice: 5000, exitPrice: 5100 })]);
    const res = await fillMissingMfe();
    expect(res.filled).toBe(0);
    expect(res.failed).toBe(1);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ mfeAttempts: { increment: 1 } });
  });

  it("падение биржи засчитывается как попытка, а не роняет проход", async () => {
    mocks.findMany.mockResolvedValue([trade({ id: "a" }), trade({ id: "b" })]);
    mocks.fetchOHLCV
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce(candles());
    const res = await fillMissingMfe({ concurrency: 1 });
    expect(res.failed).toBe(1);
    expect(res.filled).toBe(1);
  });

  it("импортированные сделки (mt4/manual) на биржу не отправляются", async () => {
    mocks.findMany.mockResolvedValue([trade({ exchange: "mt5" })]);
    const res = await fillMissingMfe();
    expect(mocks.getPublicExchange).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
  });

  it("ограничивает размер порции и параллельность", async () => {
    mocks.findMany.mockResolvedValue([]);
    await fillMissingMfe({ limit: 9999, concurrency: 99 });
    expect(mocks.findMany.mock.calls[0][0].take).toBe(200);
  });
});
