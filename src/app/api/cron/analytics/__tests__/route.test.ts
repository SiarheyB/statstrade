import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/cron/analytics/route";
import { rollupTraffic } from "@/lib/traffic/rollup";
import { runTrafficAlerts } from "@/lib/traffic/alerts";
import { recordCronRun } from "@/lib/cronHeartbeat";

vi.mock("@/lib/traffic/rollup", () => ({
  rollupTraffic: vi.fn().mockResolvedValue({ days: 3, rows: 21, deletedViews: 100, deletedSessions: 10 }),
}));
vi.mock("@/lib/traffic/alerts", () => ({ runTrafficAlerts: vi.fn().mockResolvedValue([{ kind: "drop", message: "x" }]) }));
vi.mock("@/lib/cronHeartbeat", () => ({ recordCronRun: vi.fn().mockResolvedValue(undefined) }));

const base = "https://example.com/api/cron/analytics";

describe("GET/POST /api/cron/analytics", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "secret-token";
    vi.clearAllMocks();
  });

  it("без токена не пускает", async () => {
    expect((await GET(new Request(base))).status).toBe(401);
    expect((await POST(new Request(base, { method: "POST", headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect(rollupTraffic).not.toHaveBeenCalled();
  });

  it("без CRON_SECRET в окружении отвечает 500, а не тихо работает", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(new Request(base, { headers: { authorization: "Bearer secret-token" } }))).status).toBe(500);
  });

  it("сворачивает статистику, гоняет суточные проверки и отмечает прогон", async () => {
    const res = await GET(new Request(base, { headers: { authorization: "Bearer secret-token" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, deletedViews: 100, alerts: ["drop"] });
    expect(runTrafficAlerts).toHaveBeenCalledWith("daily");
    expect(recordCronRun).toHaveBeenCalledWith("analytics.rollup", "cron");
  });
});
