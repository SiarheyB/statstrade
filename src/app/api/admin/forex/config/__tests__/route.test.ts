import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockPrisma,
  mockRecordAudit,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST, PATCH, DELETE } from "@/app/api/admin/forex/config/route";

const base = "https://example.com/api/admin/forex/config";

function req(method: string, body?: unknown, url = base) {
  return new Request(url, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("/api/admin/forex/config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminSession.mockReset();
    asAdmin();
    mockPrisma.fxCollectorConfig.findMany.mockResolvedValue([]);
  });

  describe("GET", () => {
    it("returns 404 when not an admin", async () => {
      asNonAdmin();
      const res = await GET();
      expect(res.status).toBe(404);
    });

    it("returns items on happy path", async () => {
      mockPrisma.fxCollectorConfig.findMany.mockResolvedValue([{ symbol: "EUR/USD" }]);
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toEqual([{ symbol: "EUR/USD" }]);
    });
  });

  describe("POST", () => {
    it("returns 404 when not an admin", async () => {
      asNonAdmin();
      const res = await POST(req("POST", { symbol: "EUR/USD" }));
      expect(res.status).toBe(404);
    });

    it("returns 400 on invalid JSON", async () => {
      const res = await POST(new Request(base, { method: "POST", body: "bad" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid symbol format", async () => {
      const res = await POST(req("POST", { symbol: "EURUSD" }));
      expect(res.status).toBe(400);
    });

    it("upserts and returns items on happy path", async () => {
      mockPrisma.fxCollectorConfig.upsert.mockResolvedValue({ symbol: "EUR/USD" });
      mockPrisma.fxCollectorConfig.findMany.mockResolvedValue([{ symbol: "EUR/USD" }]);
      const res = await POST(req("POST", { symbol: "eur/usd" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toEqual([{ symbol: "EUR/USD" }]);
      expect(mockPrisma.fxCollectorConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { symbol: "EUR/USD" } }),
      );
      expect(mockRecordAudit).toHaveBeenCalled();
    });

    it("returns 500 when prisma throws", async () => {
      mockPrisma.fxCollectorConfig.upsert.mockRejectedValue(new Error("db down"));
      const res = await POST(req("POST", { symbol: "EUR/USD" }));
      expect(res.status).toBe(500);
    });
  });

  describe("PATCH", () => {
    it("returns 404 when not an admin", async () => {
      asNonAdmin();
      const res = await PATCH(req("PATCH", { symbol: "EUR/USD", enabled: false }));
      expect(res.status).toBe(404);
    });

    it("returns 400 on invalid body", async () => {
      const res = await PATCH(req("PATCH", { symbol: "EUR/USD" }));
      expect(res.status).toBe(400);
    });

    it("updates enabled flag on happy path", async () => {
      mockPrisma.fxCollectorConfig.update.mockResolvedValue({ symbol: "EUR/USD" });
      const res = await PATCH(req("PATCH", { symbol: "EUR/USD", enabled: false }));
      expect(res.status).toBe(200);
      expect(mockPrisma.fxCollectorConfig.update).toHaveBeenCalledWith({
        where: { symbol: "EUR/USD" },
        data: { enabled: false },
      });
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.anything(),
        "forex.config.disable",
        expect.any(Object),
      );
    });

    it("returns 500 when prisma throws", async () => {
      mockPrisma.fxCollectorConfig.update.mockRejectedValue(new Error("db down"));
      const res = await PATCH(req("PATCH", { symbol: "EUR/USD", enabled: true }));
      expect(res.status).toBe(500);
    });
  });

  describe("DELETE", () => {
    it("returns 404 when not an admin", async () => {
      asNonAdmin();
      const res = await DELETE(req("DELETE", undefined, `${base}?symbol=EUR/USD`));
      expect(res.status).toBe(404);
    });

    it("returns 400 when symbol missing/invalid", async () => {
      const res = await DELETE(req("DELETE", undefined, base));
      expect(res.status).toBe(400);
    });

    it("deletes and returns items on happy path", async () => {
      mockPrisma.fxCollectorConfig.delete.mockResolvedValue({});
      mockPrisma.fxCollectorConfig.findMany.mockResolvedValue([]);
      const res = await DELETE(req("DELETE", undefined, `${base}?symbol=EUR/USD`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toEqual([]);
      expect(mockRecordAudit).toHaveBeenCalled();
    });

    it("returns 500 when prisma throws outside the delete-catch", async () => {
      mockPrisma.fxCollectorConfig.delete.mockResolvedValue({});
      mockPrisma.fxCollectorConfig.findMany.mockRejectedValue(new Error("db down"));
      const res = await DELETE(req("DELETE", undefined, `${base}?symbol=EUR/USD`));
      expect(res.status).toBe(500);
    });
  });
});
