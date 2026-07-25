/**
 * Тесты для computeDivergence — обнаружение дивергенций цена vs дельта/CVD
 * src/lib/orderflow.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * Мокаем Prisma на уровне модуля, чтобы fetchOrderflowCandles и computeDelta
 * получали контролируемые данные из БД.
 */
const mocks = vi.hoisted(() => {
  type CandleRow = { t: Date; o: number; h: number; l: number; c: number };
  type DeltaRow = { col: number; buy: number; sell: number };

  const findMany = vi.fn<() => Promise<CandleRow[]>>();
  const queryRaw = vi.fn<() => Promise<DeltaRow[]>>();

  return {
    findMany,
    queryRaw,
    prisma: {
      obCandle: { findMany },
      $queryRaw: queryRaw,
    },
  };
});

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

import { fetchOrderflowCandles, computeDivergence } from "@/lib/orderflow";

// Константы для тестов
const STEP_MS = 60_000; // 1 минута
const START_TIME = 1_600_000_000_000; // Начальное время для тестов
const COLS = 240; // Количество бакетов в computeDelta

/**
 * Создает массив свечей с заданными high/low значениями
 * @param basePrice Базовая цена для фона
 * @param highs Массив значений high для каждой свечи
 * @param lows Массив значений low для каждой свечи
 * @returns Массив свечей
 */
function createTestCandles(
  basePrice: number,
  highs: number[],
  lows: number[]
): { t: Date; o: number; h: number; l: number; c: number }[] {
  const candles: { t: Date; o: number; h: number; l: number; c: number }[] = [];

  for (let i = 0; i < highs.length; i++) {
    candles.push({
      t: new Date(START_TIME + i * STEP_MS),
      o: lows[i], // Открываем около low
      h: highs[i], // Высокое значение
      l: lows[i], // Низкое значение
      c: (highs[i] + lows[i]) / 2 // Закрываем посередине
    });
  }

  return candles;
}

/**
 * Создает данные дельты для computeDelta
 * Вычисляет правильный bucket (col) для каждой свечи
 * Формула из computeDelta: col = floor(i * COLS / candleCount) % COLS
 * @param deltaValues Значения дельты для каждой свечи (по порядку индекса свечи)
 * @param candleCount Общее количество свечей в таймфрейме
 * @returns Данные в формате, ожидаемом computeDelta (включая нулевые дельты)
 */
function createTestDelta(deltaValues: number[], candleCount: number): { col: number; buy: number; sell: number }[] {
  const rows: { col: number; buy: number; sell: number }[] = [];

  // Для каждой свечи создаем запись дельты в соответствующей колонке
  // Даже если дельта ноль, всё равно создаем строку (чтобы computeDelta не вернул null)
  for (let i = 0; i < deltaValues.length; i++) {
    const delta = deltaValues[i];
    const col = Math.floor((i * COLS) / candleCount);
    const clampedCol = Math.max(0, Math.min(COLS - 1, col));

    if (delta >= 0) {
      rows.push({ col: clampedCol, buy: delta, sell: 0 });
    } else {
      rows.push({ col: clampedCol, buy: 0, sell: Math.abs(delta) });
    }
  }

  return rows;
}

describe("computeDivergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Мокаем fetch, чтобы fetchOrderflowCandles не лез на реальную Binance
    // при недостаточном количестве свечей в БД.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('mock network')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("возвращает null при недостаточном количестве свечей", async () => {
    // Мокаем только 1 свечу (меньше чем minBars = 5 по умолчанию)
    mocks.findMany.mockResolvedValue([
      { t: new Date(START_TIME), o: 100, h: 100, l: 100, c: 100 }
    ]);
    mocks.queryRaw.mockResolvedValue([]);

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w",
      START_TIME, START_TIME + 100 * STEP_MS);
    expect(result).toBeNull();
  });

  it("возвращает null при пустой дельте", async () => {
    // Создаем достаточно свечей для fetchOrderflowCandles
    const candles = createTestCandles(100, [105, 110], [99, 104]);
    // Повторяем чтобы было достаточно свечей (> 5000 для 1w)
    const manyCandles = [];
    while (manyCandles.length < 5000) {
      manyCandles.push(...candles);
    }
    mocks.findMany.mockResolvedValue(manyCandles.slice(0, 5000));
    // Пустая дельта - никаких записей в ObTrade
    mocks.queryRaw.mockResolvedValue([]);

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w",
      START_TIME, START_TIME + 5000 * STEP_MS);
    expect(result).toBeNull();
  });

  it("не обнаруживает дивергенцию когда цена и дельта движутся вместе", async () => {
    const candleCount = 5000;
    const candles = createTestCandles(100,
      Array(candleCount).fill(100), // Все high = 100
      Array(candleCount).fill(99)   // Все low = 99
    );

    mocks.findMany.mockResolvedValue(candles);
    // Дельта нулевая для всех свечей, но есть записи (чтобы computeDelta не вернул null)
    mocks.queryRaw.mockResolvedValue(createTestDelta(Array(candleCount).fill(0), candleCount));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w",
      START_TIME, START_TIME + candleCount * STEP_MS, {
        lookbackBars: 10,
        minDivergenceBars: 2,
        maxDivergenceBars: 20
      });

    expect(result).not.toBeNull();
    expect(result!.signals.length).toBe(0);
  });

  it("обнаруживает Regular Bearish Divergence (цена HH, дельта LH)", async () => {
    // Паттерн: цена делает HH (Higher High), дельта делает LH (Lower High)
    // Пики на свечах 2 (high=110) и 6 (high=120) -> HH
    const highs = [100, 105, 110, 108, 106, 104, 120, 117, 114, 111];
    const lows = [99, 104, 109, 107, 105, 103, 118, 116, 113, 110];

    const candles = createTestCandles(100, highs, lows);
    const candleCount = candles.length;

    // Для Regular Bearish: цена HH (120 > 110), дельта LH (должна быть ниже на втором пике)
    // Свеча 2 → бакет floor(2 * 240 / 10) = 48
    // Свеча 6 → бакет floor(6 * 240 / 10) = 144
    // Для Regular Bearish: на втором пике (свеча 6) дельта должна быть НИЖЕ чем на первом (свеча 2)
    const deltaValues = new Array(candleCount).fill(0);
    deltaValues[2] = 8;   // Первый пик (свеча 2): дельта = 8
    deltaValues[6] = 5;   // Второй пик (свеча 6): дельта = 5 (5 < 8 => LH)

    mocks.findMany.mockResolvedValue(candles);
    mocks.queryRaw.mockResolvedValue(createTestDelta(deltaValues, candleCount));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w",
      START_TIME, START_TIME + candleCount * STEP_MS, {
        lookbackBars: candleCount,
        minDivergenceBars: 2,
        maxDivergenceBars: 20,
        minStrength: 1
      });

    expect(result).not.toBeNull();
    const rb = result!.signals.filter((s) => s.type === "regular_bearish");
    expect(rb.length).toBeGreaterThanOrEqual(1);
    expect(rb[0].label).toBe("Regular Bearish");
  });

  it("обнаружает Regular Bullish Divergence (цена LL, дельта HL)", async () => {
    // Паттерн: цена делает LL (Lower Low), дельта делает HL (Higher Low)
    // Свечи 0-9, впадины на индексах 2 (low=90) и 6 (low=85) -> LL
    const highs = [102, 97, 92, 95, 98, 101, 87, 90, 93, 96];
    const lows = [100, 95, 90, 93, 96, 99, 85, 88, 91, 94];

    const candles = createTestCandles(100, highs, lows);
    const candleCount = candles.length;

    // Для Regular Bullish: цена LL (85 < 90), дельта HL (должна быть выше на второй впадине)
    // Свеча 2 → бакет floor(2 * 240 / 10) = 48
    // Свеча 6 → бакет floor(6 * 240 / 10) = 144
    // Для Regular Bullish: на второй впадине (свеча 6) дельта должна быть ВЫШЕ (менее отрицательная) чем на первой
    const deltaValues = new Array(candleCount).fill(0);
    deltaValues[2] = -8;   // Первая впадина (свеча 2): дельта = -8
    deltaValues[6] = -3;   // Вторая впадина (свеча 6): дельта = -3 (-3 > -8 => HL)

    mocks.findMany.mockResolvedValue(candles);
    mocks.queryRaw.mockResolvedValue(createTestDelta(deltaValues, candleCount));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w",
      START_TIME, START_TIME + candleCount * STEP_MS, {
        lookbackBars: candleCount,
        minDivergenceBars: 2,
        maxDivergenceBars: 20,
        minStrength: 1
      });

    expect(result).not.toBeNull();
    const rbu = result!.signals.filter((s) => s.type === "regular_bullish");
    expect(rbu.length).toBeGreaterThanOrEqual(1);
    expect(rbu[0].label).toBe("Regular Bullish");
  });

  it("обнаружает Hidden Bullish Divergence (цена LH, дельта HH)", async () => {
    // Паттерн: цена делает LH (Lower High), дельта делает HH (Higher High)
    // Свечи 0-9, пики на индексах 1 (high=115) и 6 (high=108) -> LH
    const highs = [110, 115, 112, 109, 106, 103, 108, 105, 102, 99];
    const lows = [108, 113, 110, 107, 104, 101, 106, 103, 100, 97];

    const candles = createTestCandles(100, highs, lows);
    const candleCount = candles.length;

    // Для Hidden Bullish: цена LH (108 < 115), дельта HH (должна быть выше на втором пике)
    // Свеча 1 → бакет floor(1 * 240 / 10) = 24
    // Свеча 6 → бакет floor(6 * 240 / 10) = 144
    // Для Hidden Bullish: на втором пике (свеча 6) дельта должна быть ВЫШЕ чем на первом
    const deltaValues = new Array(candleCount).fill(0);
    deltaValues[1] = 5;    // Первый пик (свеча 1): дельта = 5
    deltaValues[6] = 21;   // Второй пик (свеча 6): дельта = 21 (21 > 5 => HH)

    mocks.findMany.mockResolvedValue(candles);
    mocks.queryRaw.mockResolvedValue(createTestDelta(deltaValues, candleCount));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w",
      START_TIME, START_TIME + candleCount * STEP_MS, {
        lookbackBars: candleCount,
        minDivergenceBars: 2,
        maxDivergenceBars: 20,
        minStrength: 1
      });

    expect(result).not.toBeNull();
    const hb = result!.signals.filter((s) => s.type === "hidden_bullish");
    expect(hb.length).toBeGreaterThanOrEqual(1);
    expect(hb[0].label).toBe("Hidden Bullish");
  });

  it("обнаружает Hidden Bearish Divergence (цена HL, дельта LL)", async () => {
    // Паттерн: цена делает HL (Higher Low), дельта делает LL (Lower Low)
    // Свечи 0-9, впадины на индексах 1 (low=85) and 6 (low=95) -> HL
    const highs = [92, 87, 90, 93, 96, 99, 97, 100, 103, 106];
    const lows = [90, 85, 88, 91, 94, 97, 95, 98, 101, 104];

    const candles = createTestCandles(100, highs, lows);
    const candleCount = candles.length;

    // Для Hidden Bearish: цена HL (95 > 85), дельта LL (должна быть ниже на второй впадине)
    // Свеча 1 → бакет floor(1 * 240 / 10) = 24
    // Свеча 6 → бакет floor(6 * 240 / 10) = 144
    // Для Hidden Bearish: на второй впадине (свеча 6) дельта должна быть НИЖЕ (более отрицательная) чем на первой
    const deltaValues = new Array(candleCount).fill(0);
    deltaValues[1] = -8;   // Первая впадина (свеча 1): дельта = -8
    deltaValues[6] = -12;  // Вторая впадина (свеча 6): дельта = -12 (-12 < -8 => LL)

    mocks.findMany.mockResolvedValue(candles);
    mocks.queryRaw.mockResolvedValue(createTestDelta(deltaValues, candleCount));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w",
      START_TIME, START_TIME + candleCount * STEP_MS, {
        lookbackBars: candleCount,
        minDivergenceBars: 2,
        maxDivergenceBars: 20,
        minStrength: 1
      });

    expect(result).not.toBeNull();
    const hbe = result!.signals.filter((s) => s.type === "hidden_bearish");
    expect(hbe.length).toBeGreaterThanOrEqual(1);
    expect(hbe[0].label).toBe("Hidden Bearish");
  });

  it("фильтрует по minStrength = 3", async () => {
    // Создаем паттерн с достаточным расстоянием между экстремумами для силы >= 3
    // 15 свечей, пики на индексах 2 (110) и 11 (130) -> расстояние = 9 свечей -> сила = floor(9/3)+1 = 4
    const highs = [100, 105, 110, 108, 106, 104, 102, 100, 98, 105, 115, 130, 125, 120, 115];
    const lows = [99, 104, 109, 107, 105, 103, 101, 99, 97, 104, 114, 129, 124, 119, 114];

    const candles = createTestCandles(100, highs, lows);
    const candleCount = candles.length;

    // Для 15 свечей и COLS=240:
    // Свеча 2 → бакет floor(2 * 240 / 15) = 32
    // Свеча 11 → бакет floor(11 * 240 / 15) = 176
    // Дельта: на первом пике 8, на втором пике 5 -> LH (для regular bearish)
    const deltaValues = new Array(candleCount).fill(0);
    deltaValues[2] = 8;
    deltaValues[11] = 5;

    mocks.findMany.mockResolvedValue(candles);
    mocks.queryRaw.mockResolvedValue(createTestDelta(deltaValues, candleCount));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w",
      START_TIME, START_TIME + candleCount * STEP_MS, {
        minStrength: 3,
        lookbackBars: candleCount,
        minDivergenceBars: 2,
        maxDivergenceBars: 20
      });

    expect(result).not.toBeNull();
    expect(result!.signals.length).toBeGreaterThanOrEqual(1);
    for (const s of result!.signals) {
      expect(s.strength).toBeGreaterThanOrEqual(3);
    }
  });

  it("возвращает пустой результат когда дивергенции нет", async () => {
    const candleCount = 5000;
    const candles = createTestCandles(100,
      Array(candleCount).fill(100).map((v, i) => v + Math.floor(i / 100)), // Медленный рост
      Array(candleCount).fill(99).map((v, i) => v + Math.floor(i / 100))
    );

    // Дельта также растет пропорционально цене (без дивергенции)
    const deltaValues = Array(candleCount).fill(0).map((v, i) => Math.floor(i / 100));

    mocks.findMany.mockResolvedValue(candles);
    mocks.queryRaw.mockResolvedValue(createTestDelta(deltaValues, candleCount));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w",
      START_TIME, START_TIME + candleCount * STEP_MS, {
        lookbackBars: 10,
        minDivergenceBars: 2,
        maxDivergenceBars: 20
      });

    expect(result).not.toBeNull();
    expect(result!.signals.length).toBe(0);
    expect(result!.totalCount).toBe(0);
    expect(result!.activeCount).toBe(0);
  });
});