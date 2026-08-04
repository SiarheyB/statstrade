import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/exchange-guides", () => ({
  getExchangeGuides: vi.fn(),
}));

vi.mock("@/lib/errorLog", () => ({
  logError: vi.fn(),
}));

import { getExchangeGuides } from "@/lib/exchange-guides";
import { logError } from "@/lib/errorLog";
import { GET } from "@/app/api/exchange-guides/route";

describe("GET /api/exchange-guides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns guides on happy path", async () => {
    (getExchangeGuides as ReturnType<typeof vi.fn>).mockResolvedValue({ binance: "guide text" });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.guides).toEqual({ binance: "guide text" });
  });

  it("returns 500 and logs error when getExchangeGuides throws", async () => {
    (getExchangeGuides as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to load guides");
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("boom"),
      expect.objectContaining({ path: "/api/exchange-guides" }),
    );
  });
});
