import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";

const mocks = vi.hoisted(() => ({
  fillMissingMfe: vi.fn().mockResolvedValue({ picked: 0, filled: 0, failed: 0 }),
  pendingMfeCount: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/analytics/mfe", () => ({
  fillMissingMfe: mocks.fillMissingMfe,
  pendingMfeCount: mocks.pendingMfeCount,
}));

import { GET } from "@/app/api/exit-efficiency/route";

const agg = [{ analyzed: 12, avg_mfe: 4.5, avg_mae: 1.25, avg_captured: 62, left_on_table: 987 }];

describe("GET /api/exit-efficiency", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([{ id: "acc-1" }]);
    mockPrisma.$queryRaw.mockResolvedValue(agg);
    mockPrisma.trade.findMany.mockResolvedValue([]);
    mockPrisma.trade.count.mockResolvedValue(0);
    vi.clearAllMocks();
    mocks.pendingMfeCount.mockResolvedValue(0);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    expect((await GET()).status).toBe(401);
  });

  it("отдаёт нули и не трогает БД, когда у юзера нет аккаунтов", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([]);
    const body = await (await GET()).json();
    expect(body.analyzed).toBe(0);
    expect(body.leftOnTableUsd).toBe(0);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("возвращает агрегат из сохранённых колонок", async () => {
    asUser();
    mockPrisma.$queryRaw.mockResolvedValue(agg);
    mockPrisma.trade.findMany.mockResolvedValue([
      { id: "w1", symbol: "BTCUSDT", capturedPct: -10 },
    ]);
    mockPrisma.trade.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

    const body = await (await GET()).json();
    expect(body.analyzed).toBe(12);
    expect(body.avgMfePct).toBe(4.5);
    expect(body.avgMaePct).toBe(1.25);
    expect(body.avgCapturedPct).toBe(62);
    expect(body.leftOnTableUsd).toBe(987);
    expect(body.worst).toEqual([{ id: "w1", symbol: "BTCUSDT", capturedPct: -10 }]);
  });

  it("худшие сделки берутся по возрастанию captured и только посчитанные", async () => {
    asUser();
    await GET();
    const args = mockPrisma.trade.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ accountId: { in: ["acc-1"] }, mfeAt: { not: null } });
    expect(args.orderBy).toEqual({ capturedPct: "asc" });
    expect(args.take).toBe(5);
  });

  it("не запускает догрузку, когда очередь пуста", async () => {
    asUser();
    mockPrisma.trade.count.mockResolvedValue(0);
    await GET();
    expect(mocks.fillMissingMfe).not.toHaveBeenCalled();
  });

  it("догружает очередь фоном, когда есть несчитанные сделки", async () => {
    asUser();
    // skipped = 0, pending = 7
    mockPrisma.trade.count.mockResolvedValueOnce(0).mockResolvedValueOnce(7);
    mocks.pendingMfeCount.mockResolvedValue(7);
    const body = await (await GET()).json();
    expect(body.pending).toBe(7);
    expect(mocks.fillMissingMfe).toHaveBeenCalled();
  });

  it("returns 500 when prisma fails", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockRejectedValueOnce(new Error("DB error"));
    expect((await GET()).status).toBe(500);
  });
});
