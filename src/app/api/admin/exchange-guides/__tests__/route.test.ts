import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/exchange-guides", () => ({
  getExchangeGuides: vi.fn(),
  saveExchangeGuide: vi.fn(),
}));

vi.mock("@/lib/errorLog", () => ({
  logError: vi.fn(),
}));

import { requireAdmin } from "@/lib/admin";
import { getExchangeGuides, saveExchangeGuide } from "@/lib/exchange-guides";
import { logError } from "@/lib/errorLog";
import { GET, PUT } from "@/app/api/admin/exchange-guides/route";

const mockSession = { userId: "a1", email: "admin@example.com" };
const base = "https://example.com/api/admin/exchange-guides";

function putReq(body: unknown) {
  return new Request(base, { method: "PUT", body: JSON.stringify(body) });
}

describe("/api/admin/exchange-guides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession);
  });

  describe("GET", () => {
    it("returns 401 when not an admin", async () => {
      (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ error: "Admin access required" }), { status: 401 }),
      );
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it("returns guides on happy path", async () => {
      (getExchangeGuides as ReturnType<typeof vi.fn>).mockResolvedValue({ binance: "guide" });
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.guides).toEqual({ binance: "guide" });
    });

    it("returns 500 and logs error when getExchangeGuides throws", async () => {
      (getExchangeGuides as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
      const res = await GET();
      expect(res.status).toBe(500);
      expect(logError).toHaveBeenCalled();
    });
  });

  describe("PUT", () => {
    it("returns 401 when not an admin", async () => {
      (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ error: "Admin access required" }), { status: 401 }),
      );
      const res = await PUT(putReq({ exchangeId: "binance", guide: "text" }));
      expect(res.status).toBe(401);
    });

    it("returns 400 when exchangeId missing", async () => {
      const res = await PUT(putReq({ guide: "text" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when guide is not a string", async () => {
      const res = await PUT(putReq({ exchangeId: "binance", guide: 123 }));
      expect(res.status).toBe(400);
    });

    it("saves guide on happy path", async () => {
      (saveExchangeGuide as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const res = await PUT(putReq({ exchangeId: "binance", guide: "text" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.exchangeId).toBe("binance");
      expect(saveExchangeGuide).toHaveBeenCalledWith("binance", "text");
    });

    it("returns 500 and logs error when saveExchangeGuide throws", async () => {
      (saveExchangeGuide as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
      const res = await PUT(putReq({ exchangeId: "binance", guide: "text" }));
      expect(res.status).toBe(500);
      expect(logError).toHaveBeenCalled();
    });
  });
});
