import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST } from "@/app/api/cron/sync/route";

vi.mock("@/lib/sync", () => ({
  runDueSyncs: vi.fn().mockResolvedValue({ due: 1, advanced: ["a1"], failed: [] }),
}));

const base = "https://example.com/api/cron/sync";

describe("GET/POST /api/cron/sync", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    process.env.CRON_SECRET = "secret-token";
    vi.clearAllMocks();
  });

  it("returns 401 without the bearer token", async () => {
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns 401 with a wrong bearer token", async () => {
    const res = await POST(
      new Request(base, { method: "POST", headers: { authorization: "Bearer wrong" } }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 500 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(new Request(base, { headers: { authorization: "Bearer secret-token" } }));
    expect(res.status).toBe(500);
  });

  it("runs due syncs on the happy path (GET)", async () => {
    const res = await GET(new Request(base, { headers: { authorization: "Bearer secret-token" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.due).toBe(1);
  });

  it("runs due syncs on the happy path (POST)", async () => {
    const res = await POST(new Request(base, { method: "POST", headers: { authorization: "Bearer secret-token" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.advanced).toEqual(["a1"]);
  });
});
