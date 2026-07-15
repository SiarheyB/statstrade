import { describe, it, expect, beforeEach } from "vitest";
import {
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, PUT, DELETE } from "@/app/api/admin/collector/config/route";

const base = "https://example.com/api/admin/collector/config";

function adminReq(method: string, url: string, body?: unknown) {
  return new Request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
}

describe("admin/collector/config", () => {
  beforeEach(() => {
    mockGetAdminSession.mockReset();
    mockPrisma.collectorConfig.findMany.mockResolvedValue([
      { symbol: "BTCUSDT", market: "futures", minCoins: 100, collectAll: false },
    ]);
    mockPrisma.collectorConfig.upsert.mockResolvedValue({});
    mockPrisma.collectorConfig.deleteMany.mockResolvedValue({ count: 1 });
  });

  describe("GET", () => {
    it("returns 404 when not an admin", async () => {
      asNonAdmin();
      expect((await GET()).status).toBe(404);
    });
    it("returns 200 with config items", async () => {
      asAdmin();
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        items: [{ symbol: "BTCUSDT", market: "futures" }],
      });
    });
  });

  describe("PUT", () => {
    it("returns 404 when not an admin", async () => {
      asNonAdmin();
      expect((await PUT(adminReq("PUT", base, { items: [] }))).status).toBe(404);
    });
    it("returns 400 for non-JSON body", async () => {
      asAdmin();
      const res = await PUT(new Request(base, { method: "PUT", body: "not json" }));
      expect(res.status).toBe(400);
    });
    it("returns 400 for validation failure (symbol too short)", async () => {
      asAdmin();
      const res = await PUT(adminReq("PUT", base, { items: [{ symbol: "B", market: "spot" }] }));
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty("details");
    });
    it("returns 200 and upserts valid config", async () => {
      asAdmin();
      const res = await PUT(
        adminReq("PUT", base, {
          items: [{ symbol: "BTCUSDT", market: "futures", collectAll: true }],
        }),
      );
      expect(res.status).toBe(200);
      expect(mockPrisma.collectorConfig.upsert).toHaveBeenCalled();
    });
  });

  describe("DELETE", () => {
    it("returns 400 when symbol is missing", async () => {
      asAdmin();
      const res = await DELETE(new Request(base, { method: "DELETE" }));
      expect(res.status).toBe(400);
    });
    it("returns 200 when deleting a symbol", async () => {
      asAdmin();
      const res = await DELETE(new Request(`${base}?symbol=BTCUSDT&market=futures`, { method: "DELETE" }));
      expect(res.status).toBe(200);
      expect(mockPrisma.collectorConfig.deleteMany).toHaveBeenCalled();
    });
  });
});
