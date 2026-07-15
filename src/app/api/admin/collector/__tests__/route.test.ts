import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";

const base = "https://example.com/api/admin/collector";

describe("GET /api/admin/collector", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    mockGetAdminSession.mockReset();
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    ({ GET } = await import("@/app/api/admin/collector/route"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.COLLECTOR_URL;
    delete process.env.COLLECTOR_METRICS_TOKEN;
  });

  it("returns 404 when not an admin", async () => {
    asNonAdmin();
    const res = await GET(new Request(base));
    expect(res.status).toBe(404);
  });

  it("returns 200 with graceful collector fallback when collector env is unset", async () => {
    asAdmin();
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feeds).toEqual([]);
    expect(body.collector.ok).toBe(false);
  });

  it("returns 200 and surfaces collector metrics when available", async () => {
    asAdmin();
    process.env.COLLECTOR_URL = "http://collector";
    process.env.COLLECTOR_METRICS_TOKEN = "tok";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ synced: true, resync: false }),
      }),
    );
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.collector.ok).toBe(true);
  });
});
