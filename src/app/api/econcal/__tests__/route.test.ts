import { describe, it, expect, vi, beforeEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/econcal/route";

vi.mock("@/lib/econcal", () => ({
  getCalendar: vi.fn().mockResolvedValue([]),
}));

const base = "https://example.com/api/econcal";

describe("GET /api/econcal", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns 200 with calendar data", async () => {
    asUser();
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("returns 200 on manual refresh (refresh=1)", async () => {
    asUser();
    const res = await GET(new Request(`${base}?refresh=1`));
    expect(res.status).toBe(200);
  });

  it("returns 500 when getCalendar throws", async () => {
    asUser();
    const { getCalendar } = await import("@/lib/econcal");
    (getCalendar as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Calendar fetch failed"));
    const res = await GET(new Request(base));
    expect(res.status).toBe(500);
  });

  it("passes every query parameter through to getCalendar", async () => {
    asUser();
    const { getCalendar } = await import("@/lib/econcal");
    const q = new URLSearchParams({
      from: "2026-01-12T00:00:00.000Z",
      to: "2026-01-19T00:00:00.000Z",
      currencies: "USD,EUR",
      impacts: "high,medium",
      category: "Inflation",
    });
    await GET(new Request(`${base}?${q}`));
    const args = (getCalendar as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(args.from?.toISOString()).toBe("2026-01-12T00:00:00.000Z");
    expect(args.to?.toISOString()).toBe("2026-01-19T00:00:00.000Z");
    expect(args.currencies).toEqual(["USD", "EUR"]);
    expect(args.impacts).toEqual(["high", "medium"]);
    expect(args.category).toBe("Inflation");
  });

  it("treats category=all and missing params as no filter", async () => {
    asUser();
    const { getCalendar } = await import("@/lib/econcal");
    await GET(new Request(`${base}?category=all&currencies=`));
    const args = (getCalendar as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(args.category).toBeUndefined();
    // Пустой параметр — это «фильтра нет», а не «пустой список валют».
    expect(args.currencies).toBeUndefined();
    expect(args.from).toBeUndefined();
    expect(args.to).toBeUndefined();
  });

  it("caches a normal response but not a manual refresh", async () => {
    asUser();
    const cached = await GET(new Request(base));
    expect(cached.headers.get("Cache-Control")).toContain("s-maxage");
    const fresh = await GET(new Request(`${base}?refresh=1`));
    expect(fresh.headers.get("Cache-Control")).toBeNull();
  });
});
