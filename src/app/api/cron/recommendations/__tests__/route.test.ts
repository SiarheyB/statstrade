import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/cron/recommendations/route";

vi.mock("@/lib/recommendations/recompute", () => ({
  recomputeRecommendations: vi.fn().mockResolvedValue({ symbolsScanned: 3, levelsWritten: 5 }),
}));

// Отметка «крон приходил» пишется в БД; здесь проверяем только сам эндпоинт,
// поэтому запись мокаем (иначе тест полез бы в реальный Postgres).
vi.mock("@/lib/cronHeartbeat", () => ({ recordCronRun: vi.fn().mockResolvedValue(undefined) }));

import { recordCronRun } from "@/lib/cronHeartbeat";

const base = "https://example.com/api/cron/recommendations";

describe("GET/POST /api/cron/recommendations", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "secret-token";
    vi.clearAllMocks();
  });

  it("returns 401 without the bearer token", async () => {
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns 401 with a wrong bearer token", async () => {
    const res = await POST(new Request(base, { method: "POST", headers: { authorization: "Bearer wrong" } }));
    expect(res.status).toBe(401);
  });

  it("returns 500 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(new Request(base, { headers: { authorization: "Bearer secret-token" } }));
    expect(res.status).toBe(500);
  });

  it("recomputes on the happy path", async () => {
    const res = await POST(new Request(base, { method: "POST", headers: { authorization: "Bearer secret-token" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.symbolsScanned).toBe(3);
    expect(body.levelsWritten).toBe(5);
    // Прогон отмечен как внешний крон — на этом админка строит статус
    // «автопересчёт работает» вместо старого «ENABLE_SCHEDULER=false».
    expect(recordCronRun).toHaveBeenCalledWith("recommendations.recompute", "cron");
  });

  it("не отмечает прогон, если запрос не авторизован", async () => {
    await GET(new Request(base));
    expect(recordCronRun).not.toHaveBeenCalled();
  });
});
