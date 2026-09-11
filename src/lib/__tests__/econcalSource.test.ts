import { describe, it, expect, vi, beforeEach } from "vitest";

// Главное правило выбора источника: показывается РОВНО тот, что выбран.
// Молчаливой подмены вторым источником нет намеренно — выбор источника это
// выбор шкалы важности и языка названий, и подмена означала бы, что человек
// смотрит не на тот календарь, который выбрал, не зная об этом.
//
// Отдельный файл от econcal.test.ts: здесь нужен мок prisma, который отвечает
// по-разному на запросы разных источников.

const mocks = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findFirstMock: vi.fn(),
  groupByMock: vi.fn(),
  deleteManyMock: vi.fn().mockResolvedValue({ count: 0 }),
  updateManyMock: vi.fn().mockResolvedValue({ count: 0 }),
  executeRawMock: vi.fn().mockResolvedValue(0),
  source: "investing" as string,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: mocks.executeRawMock,
    economicEvent: {
      findFirst: mocks.findFirstMock,
      findMany: mocks.findManyMock,
      groupBy: mocks.groupByMock,
      deleteMany: mocks.deleteManyMock,
      updateMany: mocks.updateManyMock,
    },
  },
}));

vi.mock("@/lib/featureConfig", () => ({
  getFeatureConfig: vi.fn(async () => ({ enabled: true, source: mocks.source })),
}));

import { getCalendar } from "@/lib/econcal";

const event = (source: string, title: string) => ({
  id: `${source}-1`,
  time: new Date("2026-09-11T12:30:00Z"),
  currency: "USD",
  country: "United States",
  title,
  impact: "high",
  category: "Inflation",
  forecast: null,
  previous: null,
  actual: null,
  source,
  createdAt: new Date(),
  updatedAt: new Date(),
});

/** Отвечает на запрос событий тем, что «лежит» у соответствующего источника. */
function rowsBySource(rows: Record<string, unknown[]>) {
  mocks.findManyMock.mockImplementation((args: { where?: { source?: string }; orderBy?: unknown }) => {
    // alignStoredImpacts ходит без сортировки — ему всегда пусто.
    if (!args?.orderBy) return Promise.resolve([]);
    return Promise.resolve(rows[args.where?.source ?? ""] ?? []);
  });
}

describe("getCalendar: показывается ровно выбранный источник", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Свежие данные в БД — чтобы getCalendar не полез обходить фид.
    mocks.findFirstMock.mockResolvedValue({ updatedAt: new Date() });
    mocks.groupByMock.mockResolvedValue([]);
    mocks.source = "investing";
  });

  it("отдаёт события выбранного источника", async () => {
    rowsBySource({
      investing: [event("investing", "ИПЦ (м/м)")],
      forexfactory: [event("forexfactory", "CPI m/m")],
    });
    const res = await getCalendar();
    expect(res.events.map((e) => e.title)).toEqual(["ИПЦ (м/м)"]);
    expect(res.source).toBe("investing");
  });

  it("выбранный источник пуст — календарь пуст, чужие события НЕ подставляются", async () => {
    rowsBySource({ investing: [], forexfactory: [event("forexfactory", "CPI m/m")] });
    const res = await getCalendar();
    expect(res.events).toEqual([]);
    expect(res.source).toBe("investing");
  });

  it("ни один запрос за событиями не уходит к чужому источнику", async () => {
    rowsBySource({ investing: [], forexfactory: [event("forexfactory", "CPI m/m")] });
    await getCalendar();
    const eventQueries = mocks.findManyMock.mock.calls
      .map((c) => c[0] as { orderBy?: { time?: string }; where?: { source?: string } })
      .filter((a) => a?.orderBy?.time === "asc");
    expect(eventQueries.length).toBeGreaterThan(0);
    for (const q of eventQueries) expect(q.where?.source).toBe("investing");
  });

  it("списки фильтров тоже считаются по выбранному источнику", async () => {
    rowsBySource({ investing: [], forexfactory: [event("forexfactory", "CPI m/m")] });
    await getCalendar();
    for (const call of mocks.groupByMock.mock.calls) {
      expect((call[0] as { where: { source: string } }).where.source).toBe("investing");
    }
  });

  it("то же правило и в обратную сторону", async () => {
    mocks.source = "forexfactory";
    rowsBySource({ forexfactory: [], investing: [event("investing", "ИПЦ (м/м)")] });
    const res = await getCalendar();
    expect(res.events).toEqual([]);
    expect(res.source).toBe("forexfactory");
  });

  it("выключенный календарь не ходит в базу вовсе", async () => {
    const { getFeatureConfig } = await import("@/lib/featureConfig");
    vi.mocked(getFeatureConfig).mockResolvedValueOnce({ enabled: false, source: "investing" } as never);
    rowsBySource({ investing: [], forexfactory: [event("forexfactory", "CPI m/m")] });
    const res = await getCalendar();
    expect(res.events).toEqual([]);
    expect(mocks.findManyMock).not.toHaveBeenCalled();
  });
});
