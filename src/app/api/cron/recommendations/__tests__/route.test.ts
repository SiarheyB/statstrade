import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/cron/recommendations/route";

vi.mock("@/lib/recommendations/recompute", () => ({
  recomputeRecommendations: vi.fn().mockResolvedValue({ symbolsScanned: 3, levelsWritten: 5 }),
}));

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
  });
});
