import { describe, it, expect, beforeEach, vi } from "vitest";
import { asUser, asGuest, mockGetAuthUser, mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST, DELETE } from "@/app/api/liqmap/favorites/route";

const base = "https://example.com/api/liqmap/favorites";

describe("/api/liqmap/favorites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockReset();
    asUser();
  });

  describe("GET", () => {
    it("returns 401 when not authenticated", async () => {
      asGuest();
      const res = await GET(new Request(`${base}?exchange=binance`));
      expect(res.status).toBe(401);
    });

    it("returns 400 when exchange missing", async () => {
      const res = await GET(new Request(base));
      expect(res.status).toBe(400);
    });

    it("returns favourite symbols on happy path", async () => {
      mockPrisma.favouriteTicker.findMany.mockResolvedValue([
        { symbol: "BTCUSDT" },
        { symbol: "ETHUSDT" },
      ]);
      const res = await GET(new Request(`${base}?exchange=Binance`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
      expect(mockPrisma.favouriteTicker.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "u1", exchange: "binance" } }),
      );
    });

    it("returns 500 when prisma throws", async () => {
      mockPrisma.favouriteTicker.findMany.mockRejectedValue(new Error("db down"));
      const res = await GET(new Request(`${base}?exchange=binance`));
      expect(res.status).toBe(500);
    });
  });

  describe("POST", () => {
    it("returns 401 when not authenticated", async () => {
      asGuest();
      const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({}) }));
      expect(res.status).toBe(401);
    });

    it("returns 400 when exchange or symbol missing", async () => {
      const res = await POST(
        new Request(base, { method: "POST", body: JSON.stringify({ exchange: "binance" }) }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid symbol length", async () => {
      const res = await POST(
        new Request(base, {
          method: "POST",
          body: JSON.stringify({ exchange: "binance", symbol: "BT" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("upserts favourite on happy path", async () => {
      const res = await POST(
        new Request(base, {
          method: "POST",
          body: JSON.stringify({ exchange: "Binance", symbol: "btcusdt" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(mockPrisma.favouriteTicker.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_exchange_symbol: { userId: "u1", exchange: "binance", symbol: "BTCUSDT" },
          },
        }),
      );
    });

    it("returns 500 when prisma throws", async () => {
      mockPrisma.favouriteTicker.upsert.mockRejectedValue(new Error("db down"));
      const res = await POST(
        new Request(base, {
          method: "POST",
          body: JSON.stringify({ exchange: "binance", symbol: "BTCUSDT" }),
        }),
      );
      expect(res.status).toBe(500);
    });
  });

  describe("DELETE", () => {
    it("returns 401 when not authenticated", async () => {
      asGuest();
      const res = await DELETE(new Request(base, { method: "DELETE", body: JSON.stringify({}) }));
      expect(res.status).toBe(401);
    });

    it("returns 400 when exchange or symbol missing", async () => {
      const res = await DELETE(
        new Request(base, { method: "DELETE", body: JSON.stringify({ exchange: "binance" }) }),
      );
      expect(res.status).toBe(400);
    });

    it("deletes favourite on happy path", async () => {
      const res = await DELETE(
        new Request(base, {
          method: "DELETE",
          body: JSON.stringify({ exchange: "binance", symbol: "BTCUSDT" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(mockPrisma.favouriteTicker.deleteMany).toHaveBeenCalledWith({
        where: { userId: "u1", exchange: "binance", symbol: "BTCUSDT" },
      });
    });

    it("returns 500 when prisma throws", async () => {
      mockPrisma.favouriteTicker.deleteMany.mockRejectedValue(new Error("db down"));
      const res = await DELETE(
        new Request(base, {
          method: "DELETE",
          body: JSON.stringify({ exchange: "binance", symbol: "BTCUSDT" }),
        }),
      );
      expect(res.status).toBe(500);
    });
  });

  // ─── Потолки на ввод (SECURITY_AUDIT.md) ──────────────────────────────────
  describe("лимиты", () => {
    it("не принимает биржу произвольной длины", async () => {
      const res = await POST(
        new Request(base, {
          method: "POST",
          body: JSON.stringify({ exchange: "b".repeat(5000), symbol: "BTCUSDT" }),
        }),
      );
      expect(res.status).toBe(400);
      expect(mockPrisma.favouriteTicker.upsert).not.toHaveBeenCalled();
    });

    it("не принимает символ произвольной длины", async () => {
      const res = await POST(
        new Request(base, {
          method: "POST",
          body: JSON.stringify({ exchange: "binance", symbol: "A".repeat(10000) }),
        }),
      );
      expect(res.status).toBe(400);
      expect(mockPrisma.favouriteTicker.upsert).not.toHaveBeenCalled();
    });

    it("упирается в потолок избранного", async () => {
      mockPrisma.favouriteTicker.count.mockResolvedValue(200);
      mockPrisma.favouriteTicker.findUnique.mockResolvedValue(null);
      const res = await POST(
        new Request(base, {
          method: "POST",
          body: JSON.stringify({ exchange: "binance", symbol: "BTCUSDT" }),
        }),
      );
      expect(res.status).toBe(400);
      expect(mockPrisma.favouriteTicker.upsert).not.toHaveBeenCalled();
    });

    it("на потолке всё ещё можно поднять наверх уже избранное", async () => {
      mockPrisma.favouriteTicker.count.mockResolvedValue(200);
      mockPrisma.favouriteTicker.findUnique.mockResolvedValue({ symbol: "BTCUSDT" });
      // Предыдущий тест оставил upsert отклоняющимся — clearAllMocks реализации не сбрасывает.
      mockPrisma.favouriteTicker.upsert.mockResolvedValue({});
      const res = await POST(
        new Request(base, {
          method: "POST",
          body: JSON.stringify({ exchange: "binance", symbol: "BTCUSDT" }),
        }),
      );
      expect(res.status).toBe(200);
      expect(mockPrisma.favouriteTicker.upsert).toHaveBeenCalled();
    });

    it("GET с мусорной биржей отвечает 400, а не идёт в БД", async () => {
      const res = await GET(new Request(`${base}?exchange=${"x".repeat(500)}`));
      expect(res.status).toBe(400);
      expect(mockPrisma.favouriteTicker.findMany).not.toHaveBeenCalled();
    });
  });

});
