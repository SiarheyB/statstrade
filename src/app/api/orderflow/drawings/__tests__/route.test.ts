import { describe, it, expect, vi, beforeEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser } from "@/lib/__tests__/helpers/routeMocks";
import { createDrawing, getDrawings, updateDrawing, deleteDrawing } from "@/lib/drawings";
import { GET, POST, PUT, DELETE } from "@/app/api/orderflow/drawings/route";

vi.mock("@/lib/drawings", () => ({
  createDrawing: vi.fn(),
  getDrawings: vi.fn(),
  updateDrawing: vi.fn(),
  deleteDrawing: vi.fn(),
}));

const base = "https://example.com/api/orderflow/drawings";

describe("/api/orderflow/drawings", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    (createDrawing as ReturnType<typeof vi.fn>).mockReset();
    (getDrawings as ReturnType<typeof vi.fn>).mockReset();
    (updateDrawing as ReturnType<typeof vi.fn>).mockReset();
    (deleteDrawing as ReturnType<typeof vi.fn>).mockReset();
    asUser();
  });

  describe("GET", () => {
    it("returns 401 when not authenticated", async () => {
      asGuest();
      const res = await GET(new Request(`${base}?symbol=BTCUSDT`));
      expect(res.status).toBe(401);
    });

    it("returns 400 when symbol is missing", async () => {
      const res = await GET(new Request(base));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid symbol", async () => {
      const res = await GET(new Request(`${base}?symbol=BTC%20USDT!`));
      expect(res.status).toBe(400);
    });

    it("defaults exchange to binance and returns 200 with drawings", async () => {
      (getDrawings as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "d1" }]);
      const res = await GET(new Request(`${base}?symbol=BTCUSDT`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.drawings).toEqual([{ id: "d1" }]);
      expect(getDrawings).toHaveBeenCalledWith({ userId: "u1", symbol: "BTCUSDT", exchange: "binance" });
    });

    it("passes through a custom exchange param", async () => {
      (getDrawings as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await GET(new Request(`${base}?symbol=BTCUSDT&exchange=bybit`));
      expect(getDrawings).toHaveBeenCalledWith({ userId: "u1", symbol: "BTCUSDT", exchange: "bybit" });
    });

    it("returns 500 when getDrawings throws", async () => {
      (getDrawings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
      const res = await GET(new Request(`${base}?symbol=BTCUSDT`));
      expect(res.status).toBe(500);
    });
  });

  describe("POST", () => {
    const validBody = { symbol: "BTCUSDT", toolType: "trend_line", points: [{ t: 1, price: 100 }] };

    it("returns 401 when not authenticated", async () => {
      asGuest();
      const res = await POST(new Request(base, { method: "POST", body: JSON.stringify(validBody) }));
      expect(res.status).toBe(401);
    });

    it("returns 400 when points/toolType missing", async () => {
      const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ symbol: "BTCUSDT" }) }));
      expect(res.status).toBe(400);
    });

    it("returns 201 with created drawing, defaulting exchange to binance", async () => {
      (createDrawing as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "d2", ...validBody });
      const res = await POST(new Request(base, { method: "POST", body: JSON.stringify(validBody) }));
      expect(res.status).toBe(201);
      expect(createDrawing).toHaveBeenCalledWith(
        expect.objectContaining({ exchange: "binance", userId: "u1" }),
      );
    });

    it("returns 400 when createDrawing throws an 'invalid...' error", async () => {
      (createDrawing as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("invalid points"));
      const res = await POST(new Request(base, { method: "POST", body: JSON.stringify(validBody) }));
      expect(res.status).toBe(400);
    });

    it("returns 500 for other errors", async () => {
      (createDrawing as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
      const res = await POST(new Request(base, { method: "POST", body: JSON.stringify(validBody) }));
      expect(res.status).toBe(500);
    });
  });

  describe("PUT", () => {
    it("returns 401 when not authenticated", async () => {
      asGuest();
      const res = await PUT(new Request(`${base}?id=d1`, { method: "PUT", body: JSON.stringify({}) }));
      expect(res.status).toBe(401);
    });

    it("returns 400 when id is missing", async () => {
      const res = await PUT(new Request(base, { method: "PUT", body: JSON.stringify({}) }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when drawing not found", async () => {
      (updateDrawing as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await PUT(new Request(`${base}?id=d1`, { method: "PUT", body: JSON.stringify({ color: "red" }) }));
      expect(res.status).toBe(400);
    });

    it("returns 200 with the updated drawing", async () => {
      (updateDrawing as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "d1", color: "red" });
      const res = await PUT(new Request(`${base}?id=d1`, { method: "PUT", body: JSON.stringify({ color: "red" }) }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.drawing.color).toBe("red");
    });

    it("returns 500 when updateDrawing throws unexpectedly", async () => {
      (updateDrawing as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
      const res = await PUT(new Request(`${base}?id=d1`, { method: "PUT", body: JSON.stringify({}) }));
      expect(res.status).toBe(500);
    });
  });

  describe("DELETE", () => {
    it("returns 401 when not authenticated", async () => {
      asGuest();
      const res = await DELETE(new Request(`${base}?id=d1`, { method: "DELETE" }));
      expect(res.status).toBe(401);
    });

    it("returns 400 when id is missing", async () => {
      const res = await DELETE(new Request(base, { method: "DELETE" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when drawing not found", async () => {
      (deleteDrawing as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const res = await DELETE(new Request(`${base}?id=d1`, { method: "DELETE" }));
      expect(res.status).toBe(400);
    });

    it("returns 200 with deleted: true", async () => {
      (deleteDrawing as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      const res = await DELETE(new Request(`${base}?id=d1`, { method: "DELETE" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(true);
    });

    it("returns 500 when deleteDrawing throws", async () => {
      (deleteDrawing as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
      const res = await DELETE(new Request(`${base}?id=d1`, { method: "DELETE" }));
      expect(res.status).toBe(500);
    });
  });
});
