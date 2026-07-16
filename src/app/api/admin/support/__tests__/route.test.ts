import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asGuest,
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/admin/support/route";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockGetAdminSession.mockReset();
  mockPrisma.$queryRaw.mockReset();
});

describe("GET /api/admin/support", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns 500 on query error", async () => {
    asAdmin();
    asGuest();
    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error("boom"));
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("returns tickets for admin", async () => {
    asAdmin();
    asGuest();
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        id: "t1",
        userId: "u1",
        subject: "Help",
        status: "open",
        createdAt: new Date(),
        lastMessageAt: new Date(),
        lastMessage: "hi",
        lastAuthorRole: "user",
        email: "a@b.com",
        name: "A",
        unread: 2,
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tickets)).toBe(true);
    expect(body.unread).toBe(2);
  });
});
