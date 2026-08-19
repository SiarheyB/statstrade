import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/analytics/collect/route";
import { recordHit } from "@/lib/traffic/ingest";

vi.mock("@/lib/traffic/ingest", () => ({ recordHit: vi.fn().mockResolvedValue("created") }));
vi.mock("@/lib/traffic/alerts", () => ({ maybeRunFastAlerts: vi.fn() }));
vi.mock("@/lib/traffic/track", () => ({ ingestKey: async () => "test-key" }));

const hit = {
  path: "/news",
  visitorId: "v1",
  sessionId: "s1",
  isBot: false,
  botName: null,
  botCategory: null,
  botReason: null,
  source: "search",
  refHost: "google.com",
  referrer: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  device: "desktop",
  browser: "Chrome",
  os: "macOS",
  lang: "ru",
  country: null,
  authed: false,
  userId: null,
  userAgent: "UA",
  nav: "load",
};

function post(body: unknown, key?: string) {
  return new Request("http://127.0.0.1:3000/api/analytics/collect", {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "x-analytics-key": key } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/analytics/collect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("снаружи роут как бы не существует: без общего секрета — 404", async () => {
    expect((await POST(post(hit))).status).toBe(404);
    expect((await POST(post(hit, "wrong"))).status).toBe(404);
    expect(recordHit).not.toHaveBeenCalled();
  });

  it("записывает событие, пришедшее от middleware", async () => {
    const res = await POST(post(hit, "test-key"));
    expect(res.status).toBe(200);
    expect(recordHit).toHaveBeenCalledWith(expect.objectContaining({ path: "/news", source: "search" }));
  });

  it("мусор в теле отбрасывается, а не пишется в статистику", async () => {
    expect((await POST(post("не json", "test-key"))).status).toBe(400);
    expect((await POST(post({ path: "/news" }, "test-key"))).status).toBe(400);
    expect(recordHit).not.toHaveBeenCalled();
  });
});
