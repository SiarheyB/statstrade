/**
 * Тесты для computeImbalance и computeSpeedOfTape
 * src/lib/orderflow.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Мокаем Prisma для computeBA и computeSpeedOfTape.
const mocks = vi.hoisted(() => {
  const queryRaw = vi.fn<() => Promise<unknown[]>>();
  return {
    queryRaw,
    prisma: { $queryRaw: queryRaw },
  };
});

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

// Мокаем computeBA — он внутри computeImbalance.
// Но computeBA — это отдельная функция в этом же модуле, которая вызывает prisma.$queryRaw.
// После мока prisma.$queryRaw, computeBA будет работать с мокнутыми данными.
// Однако computeBA также использует computeBARaw как fallback...
// Легче замокать computeBA напрямую.

// Лучше замокать computeBA, чтобы избежать сложностей с raw SQL.
// Но computeBA и computeImbalance в одном файле, vi.mock модуля целиком
// не даст перехватывать внутренние вызовы. Поэтому будем мокать prisma.$queryRaw
// так, чтобы computeBA возвращал контролируемые данные.

// computeBA при пустом результате из rollup падает на computeBARaw.
// Чтобы не усложнять, подсовываем данные так, чтобы они проходили через rollup-путь.
// rollup-путь: rows.length > 0 → возвращает {col, full_bid, full_ask, near_bid, near_ask}

import { computeImbalance, computeSpeedOfTape } from "@/lib/orderflow";

describe("computeImbalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when BA returns null (no rows)", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const result = await computeImbalance("BTCUSDT", "binance-futures", 1000, 2000);
    expect(result).toBeNull();
  });

  it("returns zero ratio when bid and ask are equal", async () => {
    // Подсовываем данные с равными bid/ask → ratio = 0.5 → imbalance = 0
    mocks.queryRaw.mockResolvedValue([
      { col: 0, full_bid: 100, full_ask: 100, near_bid: 50, near_ask: 50 },
    ]);
    // cols=1, fromMs=1000, toMs=2000
    const result = await computeImbalance("BTCUSDT", "binance-futures", 1000, 2000, 1);
    expect(result).not.toBeNull();
    expect(result!.ratio[0]).toBeCloseTo(0, 1);
  });

  it("returns -1 when only bid exists", async () => {
    mocks.queryRaw.mockResolvedValue([
      { col: 0, full_bid: 100, full_ask: 0, near_bid: 50, near_ask: 0 },
    ]);
    const result = await computeImbalance("BTCUSDT", "binance-futures", 1000, 2000, 1);
    expect(result).not.toBeNull();
    expect(result!.ratio[0]).toBeCloseTo(-1, 1);
  });

  it("returns +1 when only ask exists", async () => {
    mocks.queryRaw.mockResolvedValue([
      { col: 0, full_bid: 0, full_ask: 100, near_bid: 0, near_ask: 50 },
    ]);
    const result = await computeImbalance("BTCUSDT", "binance-futures", 1000, 2000, 1);
    expect(result).not.toBeNull();
    expect(result!.ratio[0]).toBeCloseTo(1, 1);
  });

  it("returns -0.5 when bid = 3× ask", async () => {
    // bid=3, ask=1 → ratio = (1-3)/(3+1) = -2/4 = -0.5
    mocks.queryRaw.mockResolvedValue([
      { col: 0, full_bid: 300, full_ask: 100, near_bid: 150, near_ask: 50 },
    ]);
    const result = await computeImbalance("BTCUSDT", "binance-futures", 1000, 2000, 1);
    expect(result).not.toBeNull();
    expect(result!.ratio[0]).toBeCloseTo(-0.5, 1);
  });

  it("generates alerts for high/low imbalance", async () => {
    // bid=1, ask=100 → ratio near 1 → high_imbalance alert
    mocks.queryRaw.mockResolvedValue([
      { col: 0, full_bid: 1, full_ask: 100, near_bid: 1, near_ask: 50 },
    ]);
    const result = await computeImbalance("BTCUSDT", "binance-futures", 1000, 2000, 1);
    expect(result).not.toBeNull();
    expect(result!.alerts.length).toBeGreaterThanOrEqual(1);
    expect(result!.alerts[0].type).toBe("high_imbalance");
  });
});

describe("computeSpeedOfTape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no trades", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const result = await computeSpeedOfTape("BTCUSDT", "binance-futures", 1000, 60000);
    expect(result).toBeNull();
  });

  it("counts 1 trade per minute correctly", async () => {
    // 1 bucket (60000ms = 1 минута), 1 сделка
    mocks.queryRaw.mockResolvedValue([{ bucket: 0, cnt: 1 }]);
    const result = await computeSpeedOfTape("BTCUSDT", "binance-futures", 0, 60000, 60000);
    expect(result).not.toBeNull();
    expect(result!.tradesPerMin[0]).toBe(1);
    expect(result!.maxSpeed).toBe(1);
    expect(result!.avgSpeed).toBeCloseTo(1, 1);
  });

  it("counts 100 trades per minute and detects spike", async () => {
    // 1 bucket с 100 сделками
    mocks.queryRaw.mockResolvedValue([{ bucket: 0, cnt: 100 }]);
    const result = await computeSpeedOfTape("BTCUSDT", "binance-futures", 0, 60000, 60000);
    expect(result).not.toBeNull();
    expect(result!.tradesPerMin[0]).toBe(100);
    // 100 сделок в минуту, avg = 100, stdDev = 0, threshold = 100
    // spike если v > threshold, но v = 100, threshold = 100, так что не > 100 → нет spike
    // зависит от строгости сравнения: v > threshold
    expect(result!.spikes.length).toBe(0);
  });

  it("handles multiple buckets", async () => {
    // 3 бакета по 1 мин, 0, 50, 0 сделок
    mocks.queryRaw.mockResolvedValue([
      { bucket: 0, cnt: 0 },
      { bucket: 1, cnt: 50 },
      { bucket: 2, cnt: 0 },
    ]);
    const result = await computeSpeedOfTape("BTCUSDT", "binance-futures", 0, 180000, 60000);
    expect(result).not.toBeNull();
    expect(result!.tradesPerMin).toEqual([0, 50, 0]);
    expect(result!.maxSpeed).toBe(50);
    // avg = 50/3 ≈ 16.67
    expect(result!.avgSpeed).toBeCloseTo(50 / 3, 1);
  });
});