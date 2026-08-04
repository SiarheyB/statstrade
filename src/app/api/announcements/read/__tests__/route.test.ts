import { describe, it, expect, beforeEach, vi } from "vitest";
import { asUser, asGuest, mockGetAuthUser, mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { POST } from "@/app/api/announcements/read/route";

const base = "https://example.com/api/announcements/read";

function req(body: unknown) {
  return new Request(base, { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/announcements/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockReset();
    asUser();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(req({ announcementId: "a1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid JSON body", async () => {
    const res = await POST(new Request(base, { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when announcementId missing", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when announcementId not a string", async () => {
    const res = await POST(req({ announcementId: 123 }));
    expect(res.status).toBe(400);
  });

  it("upserts read on happy path", async () => {
    const res = await POST(req({ announcementId: "a1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockPrisma.announcementRead.upsert).toHaveBeenCalledWith({
      where: { userId_announcementId: { userId: "u1", announcementId: "a1" } },
      create: { userId: "u1", announcementId: "a1" },
      update: {},
    });
  });

  it("returns 500 when prisma throws", async () => {
    mockPrisma.announcementRead.upsert.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ announcementId: "a1" }));
    expect(res.status).toBe(500);
  });
});
