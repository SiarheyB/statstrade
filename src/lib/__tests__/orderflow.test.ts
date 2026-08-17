import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  latestBookFindMany: vi.fn(),
  queryRaw: vi.fn(),
  findMany: vi.fn(),
  obCandleFindMany: vi.fn(),
  executeRaw: vi.fn(), // для $executeRaw (сохранение свечей с Binance в БД)
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    obBigTrade: { findMany: mocks.findMany },
    obCandle: {
      findMany: mocks.obCandleFindMany,
    },
    // Профиль текущего стакана: живое окно читает его по первичному ключу.
    obLatestBook: { findMany: mocks.latestBookFindMany },
  },
}));

import {
  fetchOrderflowCandles,
  computeDelta,
  computeFootprint,
  computeBA,
  computeBigTrades,
  computeOrderflow,
  rollupLevelFor,
  CANDLES_IN_WINDOW,
  TF_MS,
} from "@/lib/orderflow";

beforeEach(() => {
  mocks.queryRaw.mockReset();
  mocks.findMany.mockReset();
  mocks.obCandleFindMany.mockReset();
  mocks.executeRaw.mockReset();
  mocks.latestBookFindMany.mockReset();
  mocks.latestBookFindMany.mockResolvedValue([]);
});

describe("fetchOrderflowCandles", () => {
  beforeEach(() => {
    mocks.obCandleFindMany.mockReset();
  });

  it("maps ObCandle rows to OfCandle", async () => {
    const now = Date.now();
    const fromMs = now - 3_600_000 * 100;
    mocks.obCandleFindMany.mockResolvedValue([
      { t: new Date(fromMs + 1000), o: 100, h: 110, l: 90, c: 105 },
      { t: new Date(now - 600_000), o: 105, h: 115, l: 95, c: 108 },
    ]);

    const out = await fetchOrderflowCandles("BTCUSDT", "binance", "1h", fromMs, now);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ t: fromMs + 1000, o: 100, h: 110, l: 90, c: 105 });
  });

  it("uses 1m fallback for unknown range", async () => {
    mocks.obCandleFindMany.mockResolvedValue([]);

    const out = await fetchOrderflowCandles("BTCUSDT", "binance-spot", "weird", 0, 1);
    expect(out).toEqual([]);
    expect(mocks.obCandleFindMany).toHaveBeenCalledWith({
      where: {
        symbol: "BTCUSDT",
        exchange: "binance-spot",
        interval: "1m",
        t: { gte: new Date(0), lte: new Date(1) },
      },
      orderBy: { t: "asc" },
      select: { t: true, o: true, h: true, l: true, c: true },
    });
  });

  it("returns [] when findMany throws", async () => {
    mocks.obCandleFindMany.mockRejectedValue(new Error("db"));
    const out = await fetchOrderflowCandles("BTCUSDT", "binance", "1h", 0, 1);
    expect(out).toEqual([]);
  });
});

describe("fetchOrderflowCandles: живая свеча", () => {
  // Ради формирующейся свечи функция ходит в Binance. Графику это нужно
  // (опрос раз в 3 с), детекторам — нет: 366 из ~400 мс их времени уходило
  // именно сюда.
  // Ровно столько, сколько ждёт окно 1h (CANDLES_IN_WINDOW). При меньшем
  // числе срабатывает ДРУГОЙ путь — дозагрузка истории с биржи, и она от
  // live не зависит.
  const rows = Array.from({ length: 800 }, (_, i) => ({
    t: new Date(i * 3600_000), o: 1, h: 2, l: 0.5, c: 1.5,
  }));

  it("по умолчанию дозапрашивает свежую свечу", async () => {
    mocks.obCandleFindMany.mockResolvedValue(rows);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, json: async () => [],
    } as unknown as Response);
    await fetchOrderflowCandles("BTCUSDT", "binance-futures", "1h", 0, 1e12);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("с live:false в сеть не ходит", async () => {
    mocks.obCandleFindMany.mockResolvedValue(rows);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, json: async () => [],
    } as unknown as Response);
    const out = await fetchOrderflowCandles("BTCUSDT", "binance-futures", "1h", 0, 1e12, { live: false });
    expect(spy).not.toHaveBeenCalled();
    expect(out.length).toBe(rows.length);
    spy.mockRestore();
  });
});

describe("computeDelta", () => {
  it("returns null when both the rollup and the raw fallback are empty", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]); // ObTradeRollup
    mocks.queryRaw.mockResolvedValueOnce([]); // fallback на сырой ObTrade
    expect(await computeDelta("BTCUSDT", "binance", 0, 1000, 4)).toBeNull();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("не трогает сырьё, когда rollup ответил", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ col: 0, buy: 1, sell: 1 }]);
    await computeDelta("BTCUSDT", "binance", 0, 1000, 4);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("падает на сырой ObTrade, пока rollup не наполнен", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]); // rollup пуст
    mocks.queryRaw.mockResolvedValueOnce([{ col: 1, buy: 7, sell: 2 }]);
    const d = await computeDelta("BTCUSDT", "binance", 0, 1000, 4);
    expect(d!.delta).toEqual([0, 5, 0, 0]);
  });

  it("builds buy/sell/delta/cvd arrays and clamps cols", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { col: 0, buy: 10, sell: 4 },
      { col: 3, buy: 5, sell: 9 },
      { col: 99, buy: 1, sell: 1 }, // вне диапазона -> clamp к cols-1
    ]);
    const d = await computeDelta("BTCUSDT", "binance", 0, 1000, 4);
    expect(d).not.toBeNull();
    expect(d!.buy).toEqual([10, 0, 0, 6]);
    expect(d!.sell).toEqual([4, 0, 0, 10]);
    expect(d!.delta).toEqual([6, 0, 0, -4]);
    expect(d!.cvd).toEqual([6, 6, 6, 2]);
    expect(d!.times).toHaveLength(4);
  });
});

describe("computeFootprint", () => {
  it("returns null when both the rollup and the raw fallback are empty", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]); // ObFootprintRollup
    mocks.queryRaw.mockResolvedValueOnce([]); // fallback на сырой ObFootprint
    expect(await computeFootprint("BTCUSDT", "binance", "15m", 0, 1000)).toBeNull();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("не трогает сырьё, когда rollup ответил", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ candle: BigInt(0), price: 1, buy: 1, sell: 1 }]);
    await computeFootprint("BTCUSDT", "binance", "15m", 0, 1000);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("groups levels by candle, skips zero-volume rows, tracks maxVol", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { candle: BigInt(1000), price: 100, buy: 2, sell: 3 },
      { candle: BigInt(1000), price: 101, buy: 0, sell: 0 }, // пропускается
      { candle: BigInt(2000), price: 102, buy: 4, sell: 1 },
    ]);
    const fp = await computeFootprint("BTCUSDT", "binance", "15m", 0, 1000);
    expect(fp).not.toBeNull();
    expect(fp!.interval).toBe(15 * 60_000);
    expect(fp!.maxVol).toBe(5);
    expect(fp!.candles).toEqual([
      { t: 1000, levels: [{ price: 100, buy: 2, sell: 3 }] },
      { t: 2000, levels: [{ price: 102, buy: 4, sell: 1 }] },
    ]);
  });
});

describe("computeBA", () => {
  it("uses the rollup fast path and returns ratios", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { col: 0, full_bid: 10, full_ask: 10, near_bid: 5, near_ask: 5 },
      { col: 1, full_bid: 0, full_ask: 0, near_bid: 0, near_ask: 0 },
    ]);
    const ba = await computeBA("BTCUSDT", "binance", 0, 1000, 2);
    expect(ba).not.toBeNull();
    expect(ba!.times).toHaveLength(2);
    expect(ba!.full).toEqual([0.5, 0.5]);
    expect(ba!.near).toEqual([0.5, 0.5]);
  });

  it("falls back to raw path when rollup is empty", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]); // rollup пуст
    mocks.queryRaw.mockResolvedValueOnce([
      { col: 0, full_bid: 20, full_ask: 10, near_bid: 8, near_ask: 2 },
      { col: 1, full_bid: 6, full_ask: 6, near_bid: 0, near_ask: 0 },
    ]);
    const ba = await computeBA("BTCUSDT", "binance", 0, 1000, 2);
    expect(ba).not.toBeNull();
    expect(ba!.full[0]).toBeCloseTo(20 / 30, 5);
    expect(ba!.near[0]).toBeCloseTo(8 / 10, 5);
    expect(ba!.full[1]).toBe(0.5);
  });
});

describe("computeBigTrades", () => {
  it("maps rows to BigTrade with epoch t", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { t: new Date(1000), price: 50000, qty: 0.5, side: "buy", exchange: "binance" },
      { t: new Date(2000), price: 50010, qty: 1.2, side: "sell", exchange: "binance" },
    ]);
    const out = await computeBigTrades("BTCUSDT", "binance", 0, 3000, 60);
    expect(out).toEqual([
      { t: 1000, price: 50000, qty: 0.5, side: "buy", exchange: "binance" },
      { t: 2000, price: 50010, qty: 1.2, side: "sell", exchange: "binance" },
    ]);
  });
});

describe("computeOrderflow", () => {
  it("returns null when both rollup and legacy cells are empty", async () => {
    // Три уровня каскада (минутный → часовой → дневной), затем сырьё.
    mocks.queryRaw.mockResolvedValue([]);
    expect(await computeOrderflow("BTCUSDT", "binance", 0, 1000)).toBeNull();
  });

  it("builds heatmap from rollup (fast path) with last-snapshot profile", async () => {
    // 1: cells rollup, 2: colStats, 3: lastRows
    mocks.queryRaw
      .mockResolvedValueOnce([
        { col: 0, price: 100, vol: 50 },
        { col: 1, price: 105, vol: 30 },
      ])
      .mockResolvedValueOnce([
        { col: 0, n: 1, ex: 1 },
        { col: 1, n: 1, ex: 1 },
      ])
      .mockResolvedValueOnce([
        { t: new Date(1000), exchange: "binance", price: 100, bidVol: 5, askVol: 7 },
      ]);
    const hm = await computeOrderflow("BTCUSDT", "binance", 0, 1000);
    expect(hm).not.toBeNull();
    expect(hm!.bins).toBe(110);
    expect(hm!.cols).toBe(240);
    expect(hm!.grid).toHaveLength(240);
    expect(hm!.grid[0]).toHaveLength(110);
    expect(hm!.maxVal).toBe(50);
    expect(hm!.price).toBe(100);
    expect(hm!.profileMax).toBe(12);
    expect(hm!.times).toHaveLength(240);
  });

  it("falls back to legacy raw path and uses mid price when no last snapshot", async () => {
    // 1: rollup cells empty, 2: legacy cells, 3: legacy colStats, 4: lastRows empty
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ col: 0, price: 100, vol: 40 }])
      .mockResolvedValueOnce([{ col: 0, n: 1, ex: 1 }])
      .mockResolvedValueOnce([]);
    const hm = await computeOrderflow("BTCUSDT", "binance", 0, 1000);
    expect(hm).not.toBeNull();
    expect(hm!.maxVal).toBe(40);
    // без lastRows цена = середина диапазона
    expect(hm!.price).toBeGreaterThan(99);
    expect(hm!.profileMax).toBe(0);
  });
});

// ─── Каскад агрегатов (ORDERFLOW_PERF_PLAN.md §4) ──────────────────────────

describe("rollupLevelFor", () => {
  // Уровень выбирает не таймфрейм, а ширина колонки: агрегат не должен быть
  // грубее колонки, в которую он схлопывается.
  const levelForRange = (range: string) => {
    const to = Date.now();
    const from = to - TF_MS[range] * CANDLES_IN_WINDOW[range];
    return rollupLevelFor(from, to, 240);
  };

  it("мелкие таймфреймы читают минутный уровень", () => {
    expect(levelForRange("5m")).toBe("minute");
    expect(levelForRange("15m")).toBe("minute");
  });

  it("средние — часовой", () => {
    expect(levelForRange("1h")).toBe("hour");
    expect(levelForRange("4h")).toBe("hour");
  });

  it("старшие — дневной", () => {
    expect(levelForRange("12h")).toBe("day");
    expect(levelForRange("1d")).toBe("day");
    expect(levelForRange("1w")).toBe("day");
  });

  it("выбранный бакет никогда не грубее колонки", () => {
    const bucketMs = { minute: 60_000, hour: 3600_000, day: 86_400_000 };
    for (const range of Object.keys(CANDLES_IN_WINDOW)) {
      const to = Date.now();
      const from = to - TF_MS[range] * CANDLES_IN_WINDOW[range];
      const colMs = (to - from) / 240;
      expect(bucketMs[levelForRange(range)]).toBeLessThanOrEqual(colMs);
    }
  });
});

describe("computeFootprint: выбор уровня каскада", () => {
  // Имя таблицы приходит либо значением (Prisma.raw — выбранный уровень), либо
  // прямо в шаблоне запроса (жёстко зашитый путь отката).
  const tableOf = (callIndex: number): string => {
    const call = mocks.queryRaw.mock.calls[callIndex] ?? [];
    const template = Array.isArray(call[0]) ? (call[0] as string[]).join(" ") : "";
    const values = call
      .slice(1)
      .map((v: unknown) => (v as { strings?: string[] })?.strings?.join("") ?? "")
      .join(" ");
    return `${template} ${values}`;
  };

  it("свечи от часа и выше читают часовой уровень", async () => {
    mocks.queryRaw.mockResolvedValue([{ candle: 0n, price: 100, buy: 1, sell: 2 }]);
    await computeFootprint("BTCUSDT", "binance-futures", "1d", 0, 86_400_000);
    expect(tableOf(0)).toContain("ObFootprintRollupH");
  });

  it("мелкие свечи читают пятиминутный уровень", async () => {
    mocks.queryRaw.mockResolvedValue([{ candle: 0n, price: 100, buy: 1, sell: 2 }]);
    await computeFootprint("BTCUSDT", "binance-futures", "5m", 0, 300_000);
    expect(tableOf(0)).toContain('"ObFootprintRollup"');
  });

  it("спускается на пятиминутный, пока часовой не наполнен", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([]) // часовой пуст
      .mockResolvedValueOnce([{ candle: 0n, price: 100, buy: 1, sell: 2 }]);
    const fp = await computeFootprint("BTCUSDT", "binance-futures", "1d", 0, 86_400_000);
    expect(fp).not.toBeNull();
    expect(tableOf(0)).toContain("ObFootprintRollupH");
    expect(tableOf(1)).toContain('"ObFootprintRollup"');
  });
});

describe("computeOrderflow: выбор уровня каскада", () => {
  // Имя таблицы приходит в мок как Prisma.raw внутри значений запроса.
  const tablesOf = (callIndex: number): string => {
    const call = mocks.queryRaw.mock.calls[callIndex] ?? [];
    return call
      .slice(1)
      .map((v: unknown) => (v as { strings?: string[] })?.strings?.join("") ?? "")
      .join(" ");
  };

  it("широкое окно читает дневную таблицу, а не минутную", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const to = Date.now();
    await computeOrderflow("BTCUSDT", "binance-futures", to - 365 * 86_400_000, to);
    expect(tablesOf(0)).toContain("ObSnapshotRollupD");
  });

  it("узкое окно читает минутную таблицу", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const to = Date.now();
    await computeOrderflow("BTCUSDT", "binance-futures", to - 3600_000, to);
    expect(tablesOf(0)).toContain('"ObSnapshotRollup"');
  });

  it("спускается на мелкий уровень, пока каскад не наполнен", async () => {
    // Дневная и часовая пусты (каскад не догнал историю после деплоя),
    // минутная отвечает — картинка та же, просто дороже.
    mocks.queryRaw
      .mockResolvedValueOnce([]) // day
      .mockResolvedValueOnce([]) // hour
      .mockResolvedValueOnce([{ col: 0, price: 100, vol: 40 }]) // minute
      .mockResolvedValueOnce([{ col: 0, n: 2, ex: 1 }]) // счётчики минутного уровня
      .mockResolvedValueOnce([]); // профиль стакана
    const to = Date.now();
    const hm = await computeOrderflow("BTCUSDT", "binance-futures", to - 365 * 86_400_000, to);
    expect(hm).not.toBeNull();
    expect(tablesOf(0)).toContain("ObSnapshotRollupD");
    expect(tablesOf(1)).toContain("ObSnapshotRollupH");
    expect(tablesOf(2)).toContain('"ObSnapshotRollup"');
    // Счётчики берутся из таблицы ТОГО ЖЕ уровня, что и цены, иначе нормировка
    // (число бирж / число снапшотов) исказит яркость карты.
    expect(tablesOf(3)).toContain('"ObRollupBucket"');
  });

  it("узкое окно в глубоком прошлом поднимается на часовой уровень", async () => {
    // Минутный слой хранится ограниченное время (ROLLUP_MINUTE_RETENTION_DAYS),
    // поэтому на старом отрезке он пуст — карта должна прийти с часового, а не
    // пропасть совсем.
    mocks.queryRaw
      .mockResolvedValueOnce([]) // минутный слой обрезан по ретеншну
      .mockResolvedValueOnce([{ col: 0, price: 100, vol: 40 }]) // часовой
      .mockResolvedValueOnce([{ col: 0, n: 2, ex: 1 }])
      .mockResolvedValueOnce([]);
    const to = Date.now() - 200 * 86_400_000;
    const hm = await computeOrderflow("BTCUSDT", "binance-futures", to - 3600_000, to);
    expect(hm).not.toBeNull();
    expect(tablesOf(0)).toContain('"ObSnapshotRollup"');
    expect(tablesOf(1)).toContain("ObSnapshotRollupH");
    expect(tablesOf(2)).toContain("ObRollupBucketH");
  });

  it("level в опциях перекрывает автоматический выбор", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const to = Date.now();
    await computeOrderflow("BTCUSDT", "binance-futures", to - 3600_000, to, { level: "day" });
    expect(tablesOf(0)).toContain("ObSnapshotRollupD");
  });
});
