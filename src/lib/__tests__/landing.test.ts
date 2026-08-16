import { describe, it, expect, vi, beforeEach } from "vitest";

const levelSetupFindFirst = vi.fn();
const levelSetupCount = vi.fn();
const obCandleFindMany = vi.fn();
const economicEventCount = vi.fn();
const newsItemCount = vi.fn();
const getCalendar = vi.fn();
const getNews = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    levelSetup: { findFirst: levelSetupFindFirst, count: levelSetupCount },
    obCandle: { findMany: obCandleFindMany },
    economicEvent: { count: economicEventCount },
    newsItem: { count: newsItemCount },
  },
}));

vi.mock("@/lib/econcal", () => ({ getCalendar }));
vi.mock("@/lib/news", async () => {
  const actual = await vi.importActual<typeof import("@/lib/news")>("@/lib/news");
  return { ...actual, getNews };
});

// Модуль держит собственный кэш среза (TTL 5 минут) — между тестами его
// нужно сбрасывать, иначе второй тест читает данные первого.
async function freshModule() {
  vi.resetModules();
  return (await import("@/lib/landing")).getLandingData;
}

const NOW = Date.parse("2026-08-16T12:00:00Z");

function setupMocks(signal: Record<string, unknown> | null) {
  levelSetupFindFirst.mockResolvedValue(signal);
  levelSetupCount.mockResolvedValue(signal ? 9 : 0);
  // findMany вызывается дважды: список символов для счётчика и свечи сигнала.
  obCandleFindMany.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
    args?.select && "o" in args.select
      ? [{ o: 1, h: 2, l: 0.5, c: 1.5 }, { o: 1.5, h: 2.5, l: 1, c: 2 }]
      : [{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }],
  );
  economicEventCount.mockResolvedValue(5);
  newsItemCount.mockResolvedValue(4);
  getCalendar.mockResolvedValue({ events: [], currencies: [], categories: [], refreshed: [] });
  getNews.mockResolvedValue({ items: [], lang: "ru", sources: [], refreshed: [], refreshing: false });
}

const FULL_SETUP = {
  symbol: "ACUUSDT",
  bias: "false_breakout",
  direction: "short",
  levelType: "retracement",
  strength: 6,
  distanceAtr: 1.33,
  candlesTo: new Date("2026-08-15T00:00:00Z"),
  quality: { runwayAtr: 18.03, contamination: 0, crossings: 0 },
};

describe("getLandingData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("собирает срез с сигналом дня и счётчиками", async () => {
    setupMocks(FULL_SETUP);
    const getLandingData = await freshModule();
    const data = await getLandingData("ru", NOW);

    expect(data.generatedAt).toBe(NOW);
    expect(data.stats).toEqual({ setups: 9, symbols: 2, events: 5, news: 4 });
    expect(data.signal?.symbol).toBe("ACUUSDT");
    expect(data.signal?.runwayAtr).toBeCloseTo(18.03, 2);
    expect(data.signal?.total).toBe(9);
  });

  it("календарь запрашивается от полуночи текущих суток на три дня", async () => {
    setupMocks(FULL_SETUP);
    const getLandingData = await freshModule();
    await getLandingData("en", NOW);

    const args = getCalendar.mock.calls[0][0];
    expect(args.from.toISOString()).toBe("2026-08-16T00:00:00.000Z");
    expect(args.to.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });

  it("переживает старую запись quality без части метрик", async () => {
    // Метрики добавлялись со временем: у старых сетапов полей нет вовсе.
    setupMocks({ ...FULL_SETUP, quality: {} });
    const getLandingData = await freshModule();
    const data = await getLandingData("ru", NOW);

    expect(data.signal?.runwayAtr).toBeNull();
    expect(data.signal?.contamination).toBeNull();
  });

  it("оставляет только важные события и не больше трёх на день", async () => {
    setupMocks(FULL_SETUP);
    const day = (h: number, d = 16) => new Date(Date.UTC(2026, 7, d, h));
    getCalendar.mockResolvedValue({
      events: [
        { id: "low", time: day(7), impact: "low", currency: "USD", country: "US", title: "Мелочь", forecast: null, previous: null, actual: null },
        { id: "m1", time: day(8), impact: "medium", currency: "EUR", country: "EU", title: "M1", forecast: null, previous: null, actual: null },
        { id: "h1", time: day(9), impact: "high", currency: "USD", country: "US", title: "H1", forecast: null, previous: null, actual: null },
        { id: "h2", time: day(10), impact: "high", currency: "USD", country: "US", title: "H2", forecast: null, previous: null, actual: null },
        { id: "m2", time: day(11), impact: "medium", currency: "GBP", country: "UK", title: "M2", forecast: null, previous: null, actual: null },
        { id: "next-day", time: day(9, 17), impact: "high", currency: "JPY", country: "JP", title: "Завтра", forecast: null, previous: null, actual: null },
      ],
      currencies: [],
      categories: [],
      refreshed: [],
    });

    const getLandingData = await freshModule();
    const data = await getLandingData("ru", NOW);
    const ids = data.events.map((e) => e.id);

    expect(ids).not.toContain("low"); // impact=low не показываем вовсе
    expect(ids.filter((id) => id !== "next-day")).toHaveLength(3); // лимит на сутки
    expect(ids).toContain("h1"); // high приоритетнее medium
    expect(ids).toContain("h2");
    expect(ids).toContain("next-day"); // лимит считается по каждому дню отдельно
    // Внутри блока порядок хронологический, а не по важности.
    const times = data.events.map((e) => Date.parse(e.time));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("отдаёт signal: null, когда отбор не дал ни одного сетапа", async () => {
    setupMocks(null);
    const getLandingData = await freshModule();
    const data = await getLandingData("en", NOW);

    expect(data.signal).toBeNull();
    expect(data.stats.setups).toBe(0);
  });
});
