import { describe, it, expect, vi, beforeEach } from "vitest";

// Очистка чата — ровно та механика, которую нельзя проверить вживую: ждать
// трое суток, чтобы убедиться, что общий зал стёрся, никто не станет.
const db = vi.hoisted(() => ({
  // Самое старое сообщение каждого канала.
  oldest: [] as Array<{ channel: string; createdAt: Date }>,
  deleted: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gameChatMessage: {
      groupBy: vi.fn(async () =>
        db.oldest.map((row) => ({ channel: row.channel, _min: { createdAt: row.createdAt } })),
      ),
      findFirst: vi.fn(async (args: { where: { channel: string } }) => {
        const row = db.oldest.find((item) => item.channel === args.where.channel);
        return row ? { createdAt: row.createdAt } : null;
      }),
      deleteMany: vi.fn(async (args: { where: { channel: string } }) => {
        db.deleted.push(args.where.channel);
        return { count: 5 };
      }),
    },
  },
}));

import { CHAT_LIFETIME_MS, clearsAt, lifetimeOf, purgeExpiredChats } from "@/lib/game/social";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  db.oldest = [];
  db.deleted = [];
});

describe("сроки жизни каналов", () => {
  it("общий зал и рынок живут трое суток, канал фонда — неделю", () => {
    expect(lifetimeOf("general")).toBe(3 * DAY);
    expect(lifetimeOf("market")).toBe(3 * DAY);
    expect(lifetimeOf("fund:abc123")).toBe(7 * DAY);
    expect(CHAT_LIFETIME_MS.fund).toBe(7 * DAY);
  });

  it("незнакомый канал живёт как общий зал, а не вечно", () => {
    expect(lifetimeOf("whatever")).toBe(3 * DAY);
  });
});

describe("когда канал очистится", () => {
  it("считается от самого старого сообщения", async () => {
    db.oldest = [{ channel: "general", createdAt: new Date(NOW - DAY) }];
    expect(await clearsAt("general", NOW)).toBe(NOW - DAY + 3 * DAY);
  });

  it("в пустом канале обещать нечего", async () => {
    expect(await clearsAt("general", NOW)).toBeNull();
  });

  it("просроченный канал не показывает прошедшую дату", async () => {
    // Между истечением срока и ближайшим тиком проходит время: показать
    // «очистится вчера» было бы враньём.
    db.oldest = [{ channel: "general", createdAt: new Date(NOW - 10 * DAY) }];
    expect(await clearsAt("general", NOW)).toBe(NOW);
  });
});

describe("очистка", () => {
  it("стирает канал целиком, когда срок вышел", async () => {
    db.oldest = [{ channel: "general", createdAt: new Date(NOW - 3 * DAY) }];
    const cleared = await purgeExpiredChats(NOW);
    expect(db.deleted).toEqual(["general"]);
    expect(cleared).toEqual([{ channel: "general", removed: 5 }]);
  });

  it("не трогает канал, у которого срок ещё идёт", async () => {
    db.oldest = [{ channel: "general", createdAt: new Date(NOW - 2 * DAY) }];
    await purgeExpiredChats(NOW);
    expect(db.deleted).toEqual([]);
  });

  it("у фонда свой срок: трёх дней ему мало, недели хватает", async () => {
    db.oldest = [{ channel: "fund:abc", createdAt: new Date(NOW - 4 * DAY) }];
    await purgeExpiredChats(NOW);
    expect(db.deleted).toEqual([]);

    db.oldest = [{ channel: "fund:abc", createdAt: new Date(NOW - 8 * DAY) }];
    await purgeExpiredChats(NOW);
    expect(db.deleted).toEqual(["fund:abc"]);
  });

  it("каждый канал считается отдельно", async () => {
    db.oldest = [
      { channel: "general", createdAt: new Date(NOW - 5 * DAY) },
      { channel: "market", createdAt: new Date(NOW - DAY) },
      { channel: "fund:abc", createdAt: new Date(NOW - 5 * DAY) },
    ];
    await purgeExpiredChats(NOW);
    expect(db.deleted).toEqual(["general"]);
  });
});
