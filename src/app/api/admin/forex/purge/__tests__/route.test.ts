import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockPrisma,
  mockRecordAudit,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST } from "@/app/api/admin/forex/purge/route";

const base = "https://example.com/api/admin/forex/purge";

describe("/api/admin/forex/purge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminSession.mockReset();
    asAdmin();
  });

  describe("POST", () => {
    it("returns 404 when not an admin", async () => {
      asNonAdmin();
      const res = await POST(
        new Request(base, { method: "POST", body: JSON.stringify({ before: new Date().toISOString() }) }),
      );
      expect(res.status).toBe(404);
    });

    it("returns 400 on invalid JSON", async () => {
      const res = await POST(new Request(base, { method: "POST", body: "bad" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when before is not a valid datetime", async () => {
      const res = await POST(
        new Request(base, { method: "POST", body: JSON.stringify({ before: "not-a-date" }) }),
      );
      expect(res.status).toBe(400);
    });

    it("purges candles on happy path", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(5);
      const before = new Date("2026-01-01T00:00:00Z").toISOString();
      const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ before }) }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.deleted).toBe(5);
      expect(mockRecordAudit).toHaveBeenCalled();
    });

    it("purges a single symbol when only symbol is given", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(4200);
      const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ symbol: "eur/usd" }) }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, symbol: "EUR/USD", before: null, deleted: 4200 });
      expect(mockRecordAudit).toHaveBeenCalled();
    });

    it("accepts symbol together with before", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);
      const before = new Date("2026-01-01T00:00:00Z").toISOString();
      const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ symbol: "XAU/USD", before }) }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ symbol: "XAU/USD", before });
    });

    it("returns 400 for a malformed symbol", async () => {
      const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ symbol: "EURUSD" }) }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when neither before nor symbol is given", async () => {
      const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({}) }));
      expect(res.status).toBe(400);
    });

    it("returns 500 when prisma throws", async () => {
      mockPrisma.$executeRaw.mockRejectedValue(new Error("db down"));
      const before = new Date("2026-01-01T00:00:00Z").toISOString();
      const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ before }) }));
      expect(res.status).toBe(500);
    });
  });

  describe("GET", () => {
    it("returns 404 when not an admin", async () => {
      asNonAdmin();
      const res = await GET();
      expect(res.status).toBe(404);
    });

    it("returns oldest/newest bounds on happy path", async () => {
      const oldest = new Date("2025-01-01T00:00:00Z");
      const newest = new Date("2026-01-01T00:00:00Z");
      mockPrisma.$queryRaw.mockResolvedValue([{ oldest, newest }]);
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.oldest).toBe(oldest.toISOString());
      expect(body.newest).toBe(newest.toISOString());
    });

    it("returns nulls when no rows", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.oldest).toBeNull();
      expect(body.newest).toBeNull();
    });

    it("returns 500 when prisma throws", async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error("db down"));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });
});
