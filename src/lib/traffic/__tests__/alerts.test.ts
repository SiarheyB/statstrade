import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errorLog";
import { detectAnomalies, runTrafficAlerts } from "@/lib/traffic/alerts";

vi.mock("@/lib/db", () => ({
  prisma: {
    pageView: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    visitSession: { count: vi.fn() },
  },
}));
vi.mock("@/lib/errorLog", () => ({ logError: vi.fn() }));

const NOW = new Date("2026-08-19T12:00:00Z");

function setup(over: { scanners?: number; lastHitAt?: Date | null; today?: number; prevWeek?: number } = {}) {
  (prisma.pageView.count as any).mockResolvedValue(over.scanners ?? 0);
  (prisma.pageView.findMany as any).mockResolvedValue([{ path: "/wp-login.php" }, { path: "/.env" }]);
  (prisma.pageView.findFirst as any).mockResolvedValue(
    over.lastHitAt === null ? null : { ts: over.lastHitAt ?? new Date(NOW.getTime() - 60_000) },
  );
  // mockReset, а не clearAllMocks: «одноразовые» значения иначе копятся между
  // тестами и следующий тест разбирает чужую очередь.
  (prisma.visitSession.count as any).mockReset();
  (prisma.visitSession.count as any)
    .mockResolvedValueOnce(over.today ?? 0)
    .mockResolvedValueOnce(over.prevWeek ?? 0);
}

describe("detectAnomalies", () => {
  beforeEach(() => vi.clearAllMocks());

  it("на спокойном сайте молчит", async () => {
    setup();
    expect(await detectAnomalies("fast", NOW)).toEqual([]);
  });

  it("замечает всплеск сканеров и показывает примеры путей", async () => {
    setup({ scanners: 45 });
    const [a] = await detectAnomalies("fast", NOW);
    expect(a.kind).toBe("scanners");
    expect(a.message).toContain("45");
    expect(a.message).toContain("/wp-login.php");
  });

  it("единичные попытки взлома за всплеск не считает", async () => {
    setup({ scanners: 3 });
    expect(await detectAnomalies("fast", NOW)).toEqual([]);
  });

  it("замечает, что сбор посещаемости встал", async () => {
    setup({ lastHitAt: new Date(NOW.getTime() - 9 * 3600_000) });
    const kinds = (await detectAnomalies("fast", NOW)).map((a) => a.kind);
    expect(kinds).toContain("collector");
  });

  it("на пустой базе (сбор только включили) про остановку не кричит", async () => {
    setup({ lastHitAt: null });
    expect(await detectAnomalies("fast", NOW)).toEqual([]);
  });

  it("суточная проверка ловит обвал посещаемости", async () => {
    setup({ today: 3, prevWeek: 350 }); // было ~50 визитов в день, стало 3
    const [a] = await detectAnomalies("daily", NOW);
    expect(a.kind).toBe("drop");
    expect(a.message).toContain("3");
  });

  it("при малой посещаемости обвалом считать нечего — это шум", async () => {
    setup({ today: 1, prevWeek: 35 }); // база 5 визитов в день
    expect(await detectAnomalies("daily", NOW)).toEqual([]);
  });

  it("быстрая проверка недельное среднее не считает — лишние запросы к БД", async () => {
    setup({ today: 0, prevWeek: 350 });
    await detectAnomalies("fast", NOW);
    expect(prisma.visitSession.count).not.toHaveBeenCalled();
  });
});

describe("runTrafficAlerts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("пишет оповещение в журнал и не повторяет его следующие часы", async () => {
    setup({ scanners: 60 });
    const first = await runTrafficAlerts("fast", NOW);
    expect(first).toHaveLength(1);
    expect(logError).toHaveBeenCalledOnce();

    setup({ scanners: 60 });
    const again = await runTrafficAlerts("fast", new Date(NOW.getTime() + 60 * 60_000));
    expect(again).toEqual([]);
    expect(logError).toHaveBeenCalledOnce();
  });

  it("оповещения можно выключить переменной окружения", async () => {
    process.env.ANALYTICS_ALERTS = "false";
    setup({ scanners: 999 });
    expect(await runTrafficAlerts("fast", NOW)).toEqual([]);
    expect(prisma.pageView.count).not.toHaveBeenCalled();
    delete process.env.ANALYTICS_ALERTS;
  });
});
