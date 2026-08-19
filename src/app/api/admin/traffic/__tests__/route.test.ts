import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/traffic/route";

const requireAdmin = vi.fn();
vi.mock("@/lib/admin", () => ({ requireAdmin: () => requireAdmin() }));
vi.mock("@/lib/traffic/query", () => ({
  getLive: vi.fn().mockResolvedValue({ visitors: 3, views: 9, pages: [{ path: "/", visitors: 3 }], lastHitAt: "2026-08-19T12:00:00.000Z" }),
}));

describe("GET /api/admin/traffic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("не-админу не отвечает", async () => {
    requireAdmin.mockResolvedValue(new Response("no", { status: 401 }));
    expect((await GET()).status).toBe(401);
  });

  it("отдаёт срез «сейчас на сайте»", async () => {
    requireAdmin.mockResolvedValue({ userId: "u1", email: "a@b.c" });
    expect(await (await GET()).json()).toMatchObject({ visitors: 3, views: 9 });
  });
});
