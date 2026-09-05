import { describe, it, expect, vi, beforeEach } from "vitest";

// Закрытие сезона — единственная ветка, которую нельзя проверить вживую без
// трёх разных аккаунтов, поэтому здесь на моке БД проверяется именно она:
// места, начисления и то, что повторный вызов ничего не удваивает.
const db = vi.hoisted(() => ({
  season: null as { id: string; index: number; closedAt: Date | null } | null,
  players: [] as Array<{ id: string; nickname: string; equity: number; seasonStartEquity: number | null }>,
  updates: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
  results: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  resets: 0,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gameSeason: {
      findUnique: vi.fn(async () => db.season),
      findFirst: vi.fn(async () => db.season),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        if (db.season) db.season.closedAt = args.data.closedAt as Date;
        return db.season;
      }),
      create: vi.fn(async () => db.season),
    },
    gamePlayer: {
      findMany: vi.fn(async () => db.players),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        db.updates.push(args);
        return args;
      }),
      updateMany: vi.fn(async () => {
        db.resets += 1;
        return { count: db.players.length };
      }),
    },
    gameSeasonResult: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        db.results.push(args.data);
        return args.data;
      }),
    },
    gameWorldEvent: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        db.events.push(args.data);
        return args.data;
      }),
    },
    // Транзакция у Prisma принимает массив уже созданных промисов: наши моки
    // к этому моменту отработали, поэтому просто дожидаемся их.
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const { closeSeason, seasonPrize } = await import("@/lib/game/seasons");

beforeEach(() => {
  db.season = { id: "s1", index: 1, closedAt: null };
  db.players = [
    { id: "p1", nickname: "Первый", equity: 13_000, seasonStartEquity: 10_000 },
    { id: "p2", nickname: "Второй", equity: 11_000, seasonStartEquity: 10_000 },
    { id: "p3", nickname: "Третий", equity: 9_000, seasonStartEquity: 10_000 },
  ];
  db.updates = [];
  db.results = [];
  db.events = [];
  db.resets = 0;
});

describe("подведение итогов сезона", () => {
  it("места расставляются по росту за сезон, а не по деньгам", async () => {
    await closeSeason("s1");
    expect(db.results.map((r) => [r.playerId, r.rank, Math.round(r.returnPct as number)])).toEqual([
      ["p1", 1, 30],
      ["p2", 2, 10],
      ["p3", 3, -10],
    ]);
  });

  it("призовым местам начисляются деньги и престиж", async () => {
    await closeSeason("s1");
    const first = db.updates.find((u) => u.where.id === "p1");
    expect(first).toBeDefined();
    expect(first!.data.pendingPayout).toEqual({ increment: seasonPrize(1).cash });
    expect(first!.data.prestige).toEqual({ increment: seasonPrize(1).prestige });
  });

  it("проигравший тоже попадает в таблицу итогов, но без награды", async () => {
    await closeSeason("s1");
    const last = db.results.find((r) => r.playerId === "p3");
    expect(last!.reward).toBe(0);
  });

  it("победитель попадает в ленту мира", async () => {
    await closeSeason("s1");
    expect(db.events).toHaveLength(1);
    expect(db.events[0].kind).toBe("season_won");
  });

  it("все выходят из сезона — в новый входят заново", async () => {
    await closeSeason("s1");
    expect(db.resets).toBe(1);
  });

  it("повторный вызов ничего не удваивает", async () => {
    await closeSeason("s1");
    const results = db.results.length;
    const updates = db.updates.length;
    await closeSeason("s1");
    expect(db.results).toHaveLength(results);
    expect(db.updates).toHaveLength(updates);
  });

  it("меньше трёх участников — сезон закрывается без наград", async () => {
    db.players = db.players.slice(0, 2);
    await closeSeason("s1");
    // Итоги записаны, но денег никто не получил: первое место в мире из двух
    // человек достаётся за факт присутствия.
    expect(db.results).toHaveLength(2);
    expect(db.updates.filter((u) => u.data.pendingPayout)).toHaveLength(0);
    expect(db.events).toHaveLength(0);
  });
});

describe("награда только за прибыльный сезон", () => {
  it("убыточный игрок не получает денег, даже попав в призовые места", async () => {
    // В немноголюдном сезоне третье место из трёх — это не достижение:
    // приз за слитый счёт обесценивает приз вообще.
    db.players = [
      { id: "p1", nickname: "Первый", equity: 13_000, seasonStartEquity: 10_000 },
      { id: "p2", nickname: "Второй", equity: 11_000, seasonStartEquity: 10_000 },
      { id: "p3", nickname: "Третий", equity: 9_000, seasonStartEquity: 10_000 },
    ];
    await closeSeason("s1");
    expect(db.results.find((r) => r.playerId === "p3")!.reward).toBe(0);
    expect(db.updates.find((u) => u.where.id === "p3")).toBeUndefined();
  });

  it("если весь сезон в минусе, наград нет вовсе и победителя не объявляют", async () => {
    db.players = [
      { id: "p1", nickname: "Первый", equity: 9_500, seasonStartEquity: 10_000 },
      { id: "p2", nickname: "Второй", equity: 9_000, seasonStartEquity: 10_000 },
      { id: "p3", nickname: "Третий", equity: 8_000, seasonStartEquity: 10_000 },
    ];
    await closeSeason("s1");
    expect(db.updates.filter((u) => u.data.pendingPayout)).toHaveLength(0);
    expect(db.events).toHaveLength(0);
    // Итоги при этом записаны: сезон был, места известны.
    expect(db.results).toHaveLength(3);
  });
});
