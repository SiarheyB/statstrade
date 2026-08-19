import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { getDailyHistory, rollupTraffic } from "@/lib/traffic/rollup";

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRawUnsafe: vi.fn(),
    pageView: { deleteMany: vi.fn() },
    visitSession: { deleteMany: vi.fn() },
    trafficDaily: { findMany: vi.fn() },
  },
}));

const NOW = new Date("2026-08-19T03:05:00Z");

describe("rollupTraffic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$executeRawUnsafe as any).mockResolvedValue(3);
    (prisma.pageView.deleteMany as any).mockResolvedValue({ count: 500 });
    (prisma.visitSession.deleteMany as any).mockResolvedValue({ count: 120 });
  });

  it("сворачивает все разрезы и чистит сырьё старше срока хранения", async () => {
    const res = await rollupTraffic(3, NOW);

    // По разрезу на запрос: total, path, source, refHost, device, country, bot.
    expect((prisma.$executeRawUnsafe as any).mock.calls).toHaveLength(7);
    expect(res).toMatchObject({ days: 3, rows: 21, deletedViews: 500, deletedSessions: 120 });

    const cutoff = (prisma.pageView.deleteMany as any).mock.calls[0][0].where.ts.lt as Date;
    expect(Math.round((NOW.getTime() - cutoff.getTime()) / 86_400_000)).toBe(90);
  });

  it("пересчёт идемпотентный — конфликт по суткам обновляет строку, а не добавляет", async () => {
    await rollupTraffic(3, NOW);
    const sql = (prisma.$executeRawUnsafe as any).mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT ("day", "kind", "scope", "key") DO UPDATE');
    // Роботы и люди считаются раздельно.
    expect(sql).toContain(`CASE WHEN "isBot" THEN 'bot' ELSE 'human' END`);
  });

  it("захватывает несколько последних суток: пропущенные дни доедут следующим прогоном", async () => {
    await rollupTraffic(3, NOW);
    const from = (prisma.$executeRawUnsafe as any).mock.calls[0][1] as Date;
    expect(from.toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });
});

describe("getDailyHistory", () => {
  it("отдаёт агрегаты в виде суточного ряда", async () => {
    (prisma.trafficDaily.findMany as any).mockResolvedValue([
      { day: new Date("2026-08-18T00:00:00Z"), kind: "human", views: 40, sessions: 12, visitors: 9 },
    ]);
    expect(await getDailyHistory(new Date("2026-08-01"), new Date("2026-08-19"))).toEqual([
      { day: "2026-08-18", kind: "human", views: 40, sessions: 12, visitors: 9 },
    ]);
  });
});
