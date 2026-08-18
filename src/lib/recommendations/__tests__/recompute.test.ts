import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { dropUnclosedBar, pickStrongestPerSymbol, recomputeRecommendations } from "../recompute";
import * as featureConfig from "@/lib/featureConfig";

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 0, 1);

function row(dayOffset: number, o: number, h: number, l: number, c: number) {
  return { symbol: "BTCUSDT", exchange: "binance-futures", interval: "1d", t: new Date(START + dayOffset * DAY_MS), o, h, l, c, v: 0 };
}

// Серия, проходящая фильтр качества (quality.ts): ровный фон, один пивотный
// хай на 110 (это и есть уровень), затем спокойный подход малыми барами
// вплотную под уровень — «уровень без запилов, день закрылся у уровня».
function seriesWithPivot() {
  const rows = Array.from({ length: 30 }, (_, i) => row(i, 100, 102, 98, 100));
  rows[20] = row(20, 100, 110, 98, 100); // pivot high at 110
  for (let i = 30; i < 40; i++) rows.push(row(i, 109.6, 110, 109.4, 109.9));
  return rows;
}

// Как свечи приходят ИЗ БАЗЫ: запрос идёт с `orderBy: { t: "desc" }`, то есть
// новейшие первыми (recompute разворачивает их обратно). Моки обязаны отдавать
// тот же порядок, иначе тест проверял бы не то, что работает в проде.
function asDbRows(series: ReturnType<typeof seriesWithPivot>) {
  return [...series].reverse();
}

// Та же серия, но уровень распилен: цена многократно перекладывалась через
// 110 — такой уровень фильтр качества обязан отбросить.
function choppedSeries() {
  const rows = seriesWithPivot();
  for (let i = 22; i < 30; i += 2) {
    rows[i] = row(i, 108, 113, 107, 112); // закрытие выше уровня
    rows[i + 1] = row(i + 1, 112, 113, 106, 107); // и обратно под уровень
  }
  return rows;
}

// Падающий тренд, а близкий уровень — ПИВОТНЫЙ ХАЙ над ценой: пробой такого
// уровня подразумевал бы лонг, то есть сделку против направления рынка.
// Ровно случай LABUSDT 18.08.2026, из-за которого правило «только по тренду»
// расширили с ЛП на все сетапы.
function downtrendUnderPivotHigh() {
  const rows = [];
  let i = 0;
  for (; i < 60; i++) {
    const p = 200 - i * 1.4; // 200 -> ~117
    rows.push(row(i, p, p + 0.5, p - 1.5, p - 1));
  }
  rows.push(row(i++, 118, 125, 117.5, 124)); // пивотный хай на 125
  for (; i < 80; i++) rows.push(row(i, 124.8, 124.95, 124.75, 124.9)); // подход вплотную снизу
  return rows;
}

describe("recomputeRecommendations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({
      enabled: true,
      maxDistanceAtr: 1.5,
    } as Awaited<ReturnType<typeof featureConfig.getFeatureConfig>>);
    mockPrisma.levelSetup.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.levelSetup.createMany.mockResolvedValue({ count: 0 });
  });

  it("loads the NEWEST candles, not the oldest ones", async () => {
    mockPrisma.obCandle.findMany
      .mockResolvedValueOnce([{ symbol: "BTCUSDT" }])
      .mockResolvedValueOnce(asDbRows(seriesWithPivot()));

    await recomputeRecommendations();
    // Второй вызов — загрузка свечей инструмента. С `asc` + `take` база
    // вернула бы самые старые бары, и анализ шёл бы по позапрошлым месяцам.
    const candlesQuery = mockPrisma.obCandle.findMany.mock.calls[1][0];
    expect(candlesQuery.orderBy).toEqual({ t: "desc" });
    expect(candlesQuery.take).toBeGreaterThanOrEqual(130); // хватает на «экстремум за 6 мес.»
  });

  it("analyses the latest bar — currentPrice is the most recent close", async () => {
    const series = seriesWithPivot();
    const lastClose = series[series.length - 1].c;
    mockPrisma.obCandle.findMany
      .mockResolvedValueOnce([{ symbol: "BTCUSDT" }])
      .mockResolvedValueOnce(asDbRows(series));

    await recomputeRecommendations();
    const data = mockPrisma.levelSetup.createMany.mock.calls[0][0].data as {
      currentPrice: number;
      candlesTo: Date;
    }[];
    expect(data[0].currentPrice).toBe(lastClose);
    expect(data[0].candlesTo.getTime()).toBe(series[series.length - 1].t.getTime());
  });

  it("skips symbols with too few candles", async () => {
    mockPrisma.obCandle.findMany
      .mockResolvedValueOnce([{ symbol: "SHORTUSDT" }])
      .mockResolvedValueOnce(Array.from({ length: 5 }, (_, i) => row(i, 100, 101, 99, 100)));

    const result = await recomputeRecommendations();
    expect(result.symbolsScanned).toBe(1);
    expect(result.levelsWritten).toBe(0);
    expect(mockPrisma.levelSetup.createMany).not.toHaveBeenCalled();
  });

  it("truncates and refills LevelSetup with detected levels near price", async () => {
    mockPrisma.obCandle.findMany
      .mockResolvedValueOnce([{ symbol: "BTCUSDT" }])
      .mockResolvedValueOnce(asDbRows(seriesWithPivot()));

    const result = await recomputeRecommendations();
    expect(result.symbolsScanned).toBe(1);
    expect(result.levelsWritten).toBeGreaterThan(0);
    expect(mockPrisma.levelSetup.deleteMany).toHaveBeenCalledWith({});
    expect(mockPrisma.levelSetup.createMany).toHaveBeenCalledTimes(1);
    const data = mockPrisma.levelSetup.createMany.mock.calls[0][0].data as unknown[];
    expect(data.length).toBe(result.levelsWritten);
    expect((data[0] as { symbol: string }).symbol).toBe("BTCUSDT");
  });

  it("drops levels the quality gate rejects — a chopped level never reaches the DB", async () => {
    mockPrisma.obCandle.findMany
      .mockResolvedValueOnce([{ symbol: "CHOPUSDT" }])
      .mockResolvedValueOnce(asDbRows(choppedSeries()));

    const result = await recomputeRecommendations();
    expect(result.levelsWritten).toBe(0);
    expect(result.candidates).toBe(0);
    expect(result.rejected.level_chopped).toBeGreaterThan(0);
    expect(mockPrisma.levelSetup.createMany).not.toHaveBeenCalled();
  });

  it("drops counter-trend setups — no breakout long while the market falls", async () => {
    mockPrisma.obCandle.findMany
      .mockResolvedValueOnce([{ symbol: "FALLUSDT" }])
      .mockResolvedValueOnce(asDbRows(downtrendUnderPivotHigh()));

    const result = await recomputeRecommendations();
    expect(result.rejected.counter_trend).toBeGreaterThan(0);
    expect(result.levelsWritten).toBe(0);
    expect(mockPrisma.levelSetup.createMany).not.toHaveBeenCalled();
  });

  it("writes one setup per symbol — never the same instrument twice", async () => {
    mockPrisma.obCandle.findMany
      .mockResolvedValueOnce([{ symbol: "AAAUSDT" }, { symbol: "BBBUSDT" }])
      .mockResolvedValueOnce(asDbRows(seriesWithPivot()))
      .mockResolvedValueOnce(asDbRows(seriesWithPivot()));

    const result = await recomputeRecommendations();
    const data = mockPrisma.levelSetup.createMany.mock.calls[0][0].data as { symbol: string }[];
    const symbols = data.map((d) => d.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(symbols).toEqual(["AAAUSDT", "BBBUSDT"]);
    expect(result.levelsWritten).toBe(2);
  });

  it("does not cap the list — every symbol that passes the gate is written", async () => {
    const symbols = Array.from({ length: 25 }, (_, i) => ({ symbol: `SYM${i}USDT` }));
    mockPrisma.obCandle.findMany.mockResolvedValueOnce(symbols);
    for (let i = 0; i < symbols.length; i++) {
      mockPrisma.obCandle.findMany.mockResolvedValueOnce(asDbRows(seriesWithPivot()));
    }

    const result = await recomputeRecommendations();
    expect(result.levelsWritten).toBe(25);
  });

  it("stores a trade direction and never stores neutral setups", async () => {
    mockPrisma.obCandle.findMany
      .mockResolvedValueOnce([{ symbol: "BTCUSDT" }])
      .mockResolvedValueOnce(asDbRows(seriesWithPivot()));

    await recomputeRecommendations();
    const data = mockPrisma.levelSetup.createMany.mock.calls[0][0].data as {
      bias: string;
      direction: string;
      levelPrice: number;
      currentPrice: number;
    }[];
    for (const row of data) {
      expect(row.bias).not.toBe("neutral");
      expect(["long", "short"]).toContain(row.direction);
      // Уровень выше цены: пробой → лонг, ложный пробой → шорт (и наоборот).
      const above = row.levelPrice >= row.currentPrice;
      const expected = row.bias === "breakout" ? (above ? "long" : "short") : above ? "short" : "long";
      expect(row.direction).toBe(expected);
    }
  });

  it("reports progress through the callbacks", async () => {
    mockPrisma.obCandle.findMany
      .mockResolvedValueOnce([{ symbol: "BTCUSDT" }])
      .mockResolvedValueOnce(asDbRows(seriesWithPivot()));

    const listed: number[] = [];
    const started: string[] = [];
    const done: number[] = [];
    let writeStarted = false;

    await recomputeRecommendations({
      onSymbolsListed: (n) => listed.push(n),
      onSymbolStart: (s) => started.push(s),
      onSymbolDone: (_s, i) => done.push(i),
      onWriteStart: () => {
        writeStarted = true;
      },
    });

    expect(listed).toEqual([1]);
    expect(started).toEqual(["BTCUSDT"]);
    expect(done).toEqual([0]);
    expect(writeStarted).toBe(true);
  });
});

describe("pickStrongestPerSymbol", () => {
  it("keeps the highest-scoring setup and drops the rest for that symbol", () => {
    // Один инструмент дал два противоположных сетапа — в выдачу должен пойти
    // только сильнейший, иначе он висел бы в списке и в лонг, и в шорт.
    const rows = [
      { symbol: "BTCUSDT", score: 0.4, bias: "breakout", direction: "long" },
      { symbol: "BTCUSDT", score: 0.8, bias: "false_breakout", direction: "short" },
      { symbol: "ETHUSDT", score: 0.5, bias: "breakout", direction: "long" },
    ];

    const best = pickStrongestPerSymbol(rows);
    expect(best.size).toBe(2);
    expect(best.get("BTCUSDT")).toMatchObject({ score: 0.8, bias: "false_breakout", direction: "short" });
    expect(best.get("ETHUSDT")).toMatchObject({ score: 0.5 });
  });

  it("is stable when scores tie — keeps the first seen", () => {
    const rows = [
      { symbol: "BTCUSDT", score: 0.5, bias: "breakout" },
      { symbol: "BTCUSDT", score: 0.5, bias: "false_breakout" },
    ];
    expect(pickStrongestPerSymbol(rows).get("BTCUSDT")).toMatchObject({ bias: "breakout" });
  });
});

describe("dropUnclosedBar", () => {
  const DAY = 86_400_000;
  const day = (n: number) => ({ t: Date.UTC(2026, 7, n), o: 1, h: 2, l: 0.5, c: 1.5 });

  it("drops the last bar while its day is still running", () => {
    // 13.08 12:00 UTC: бар 13.08 открылся в 00:00 и закроется только в 24:00.
    const now = Date.UTC(2026, 7, 13, 12);
    const candles = [day(11), day(12), day(13)];
    expect(dropUnclosedBar(candles, now).map((c) => c.t)).toEqual([day(11).t, day(12).t]);
  });

  it("keeps every bar once the last one has closed", () => {
    const now = Date.UTC(2026, 7, 13) + DAY + 60_000; // минута после закрытия 13.08
    const candles = [day(11), day(12), day(13)];
    expect(dropUnclosedBar(candles, now)).toHaveLength(3);
  });

  it("drops the bar that opened five minutes ago — the scheduler's slot", () => {
    // 00:05 UTC — момент планового пересчёта. Свежий бар почти пустой
    // (o≈h≈l≈c), считать по нему ATR и «закрытие у уровня» нельзя.
    const now = Date.UTC(2026, 7, 13, 0, 5);
    expect(dropUnclosedBar([day(11), day(12), day(13)], now).map((c) => c.t)).toEqual([day(11).t, day(12).t]);
  });

  it("tolerates an empty series", () => {
    expect(dropUnclosedBar([], Date.now())).toEqual([]);
  });
});
