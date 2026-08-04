import { describe, it, expect, beforeEach, vi } from "vitest";
import { asUser, asGuest, mockGetAuthUser, mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/announcements/route";

const base = "https://example.com/api/announcements";

describe("GET /api/announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockReset();
    asUser();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("filters to active announcements by default", async () => {
    mockPrisma.announcement.findMany.mockResolvedValue([]);
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    expect(mockPrisma.announcement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it("returns all announcements when all=1", async () => {
    mockPrisma.announcement.findMany.mockResolvedValue([]);
    const res = await GET(new Request(`${base}?all=1`));
    expect(res.status).toBe(200);
    expect(mockPrisma.announcement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it("maps announcements with readAt on happy path", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const readAt = new Date("2026-01-02T00:00:00Z");
    mockPrisma.announcement.findMany.mockResolvedValue([
      { id: "1", title: "T", body: "B", active: true, createdAt, reads: [{ readAt }] },
      { id: "2", title: "T2", body: "B2", active: true, createdAt, reads: [] },
    ]);
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.announcements).toEqual([
      {
        id: "1",
        title: "T",
        body: "B",
        active: true,
        createdAt: createdAt.toISOString(),
        readAt: readAt.toISOString(),
      },
      {
        id: "2",
        title: "T2",
        body: "B2",
        active: true,
        createdAt: createdAt.toISOString(),
        readAt: null,
      },
    ]);
  });

  it("returns 500 when prisma throws", async () => {
    mockPrisma.announcement.findMany.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request(base));
    expect(res.status).toBe(500);
  });
});
