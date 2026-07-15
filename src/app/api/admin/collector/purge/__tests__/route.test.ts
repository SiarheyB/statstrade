import { describe, it, expect, beforeEach } from "vitest";
import {
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { POST, GET } from "@/app/api/admin/collector/purge/route";

const base = "https://example.com/api/admin/collector/purge";

describe("admin/collector/purge", () => {
  beforeEach(() => {
    mockGetAdminSession.mockReset();
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    mockPrisma.$executeRaw.mockResolvedValue(0);
    mockPrisma.$queryRaw.mockResolvedValue([{ oldest: null, newest: null }]);
  });

  describe("POST", () => {
    it("returns 404 when not an admin", async () => {
      asNonAdmin();
      const res = await POST(
        new Request(base, {
          method: "POST",
          body: JSON.stringify({ before: "2024-01-01T00:00:00Z" }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(404);
    });
    it("returns 400 for an invalid date", async () => {
      asAdmin();
      const res = await POST(
        new Request(base, {
          method: "POST",
          body: JSON.stringify({ before: "not-a-date" }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("дату") });
    });
    it("returns 200 and purges with a valid date", async () => {
      asAdmin();
      const res = await POST(
        new Request(base, {
          method: "POST",
          body: JSON.stringify({ before: "2024-01-01T00:00:00Z" }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body).toHaveProperty("total");
    });
  });

  describe("GET", () => {
    it("returns 404 when not an admin", async () => {
      asNonAdmin();
      expect((await GET()).status).toBe(404);
    });
    it("returns 200 with history bounds", async () => {
      asAdmin();
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("oldest");
      expect(body).toHaveProperty("newest");
    });
  });
});
