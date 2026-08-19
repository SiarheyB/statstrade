import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/analytics/beacon/route";
import { recordHit } from "@/lib/traffic/ingest";

vi.mock("@/lib/traffic/ingest", () => ({ recordHit: vi.fn().mockResolvedValue("created") }));

const cookieBag = { current: new Map<string, string>() };
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      host: "tradestats.app",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/125.0 Safari/537.36",
      "accept-language": "ru-RU,ru;q=0.9",
      "sec-fetch-mode": "navigate",
    }),
  cookies: async () => ({ get: (k: string) => (cookieBag.current.has(k) ? { value: cookieBag.current.get(k) } : undefined) }),
}));

const rateOk = { ok: true, retryAfterSec: 0 };
const rate = vi.fn(() => rateOk);
vi.mock("@/lib/ratelimit", () => ({ rateLimit: () => rate(), clientIp: () => "1.2.3.4" }));

const post = (body: unknown) =>
  new Request("https://tradestats.app/api/analytics/beacon", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/analytics/beacon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rate.mockReturnValue(rateOk);
    cookieBag.current = new Map([["ts_vid", "vid-1"], ["ts_sid", "sid-1"]]);
  });

  it("помечает визит как «JS исполнился» и приносит экран", async () => {
    const res = await POST(post({ path: "/dashboard/trades", screen: "1920x1080", referrer: null }));
    expect(res.status).toBe(200);
    expect(recordHit).toHaveBeenCalledWith(
      expect.objectContaining({ js: true, screen: "1920x1080", nav: "spa", path: "/dashboard/trades", sessionId: "sid-1" }),
    );
  });

  it("путь нормализуется — токен публичной ссылки в статистику не попадает", async () => {
    await POST(post({ path: "/share/secret-token" }));
    expect(recordHit).toHaveBeenCalledWith(expect.objectContaining({ path: "/share/[token]" }));
  });

  it("накрутку счётчика режет лимит запросов", async () => {
    rate.mockReturnValue({ ok: false, retryAfterSec: 30 });
    expect((await POST(post({ path: "/" }))).status).toBe(429);
    expect(recordHit).not.toHaveBeenCalled();
  });

  it("мусор в теле отбрасывается", async () => {
    expect((await POST(post("не json"))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
    expect(recordHit).not.toHaveBeenCalled();
  });
});
