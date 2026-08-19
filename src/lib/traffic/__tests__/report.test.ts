import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTrafficReport } from "@/lib/traffic/report";
import * as q from "@/lib/traffic/query";

vi.mock("@/lib/traffic/query", () => ({
  getTotals: vi.fn(),
  getSessionStats: vi.fn(),
  getSeries: vi.fn().mockResolvedValue([]),
  getTopPages: vi.fn().mockResolvedValue([]),
  getSources: vi.fn().mockResolvedValue([]),
  getCampaigns: vi.fn().mockResolvedValue([]),
  getBreakdown: vi.fn().mockResolvedValue([]),
  getBots: vi.fn().mockResolvedValue([]),
  getRecentVisits: vi.fn().mockResolvedValue([]),
  getLive: vi.fn().mockResolvedValue({ visitors: 0, views: 0, pages: [], lastHitAt: null }),
}));

const totals = (humanViews: number, humanVisitors: number) => ({
  views: humanViews, sessions: 0, visitors: humanVisitors, botViews: 0, botSessions: 0, humanViews, humanVisitors,
});
const sessions = (n: number) => ({
  sessions: n, bounces: 0, bounceRate: 0, avgDurationSec: 0, viewsPerSession: 0,
  registered: 1, loggedIn: 0, jsConfirmed: 0, newVisitors: 0,
});

const NOW = new Date("2026-08-19T12:00:00Z");

describe("getTrafficReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (q.getTotals as any).mockResolvedValueOnce(totals(120, 30)).mockResolvedValueOnce(totals(80, 40));
    (q.getSessionStats as any).mockResolvedValueOnce(sessions(50)).mockResolvedValueOnce(sessions(25));
  });

  it("считает изменение к прошлому периоду и отдаёт его цифры", async () => {
    const r = await getTrafficReport("7d", 180, "human", NOW);
    expect(r.deltas).toEqual({ views: 0.5, visitors: -0.25, sessions: 1 });
    expect(r.previous).toMatchObject({ views: 80, visitors: 40, sessions: 25 });
  });

  it("прошлый период — тот же по длине и примыкает к текущему", async () => {
    await getTrafficReport("7d", 0, "human", NOW);
    const [cur, prev] = (q.getTotals as any).mock.calls.map((c: any[]) => c[0]);
    expect(prev.to.getTime()).toBe(cur.from.getTime());
    expect(cur.to.getTime() - cur.from.getTime()).toBe(prev.to.getTime() - prev.from.getTime());
  });

  it("фильтр аудитории и таймзона доезжают до запросов", async () => {
    await getTrafficReport("30d", 180, "bot", NOW);
    const range = (q.getTopPages as any).mock.calls[0][0];
    expect(range).toMatchObject({ audience: "bot", tzOffsetMin: 180, bucket: "day" });
  });

  it("«сегодня» рисуется по часам", async () => {
    const r = await getTrafficReport("today", 0, "human", NOW);
    expect(r.range.bucket).toBe("hour");
  });
});
