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
    (getCalendar as unknown as vi.Mock).mockRejectedValueOnce(new Error("Calendar fetch failed"));
    const res = await GET(new Request(base));
    expect(res.status).toBe(500);
  });
});
