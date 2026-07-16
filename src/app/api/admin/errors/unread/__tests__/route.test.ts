import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asGuest,
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/admin/errors/unread/route";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockGetAdminSession.mockReset();
  mockPrisma.errorLog.count.mockResolvedValue(0);
});

describe("GET /api/admin/errors/unread", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns unread count for admin", async () => {
    asAdmin();
    asGuest();
    mockPrisma.errorLog.count.mockResolvedValue(7);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(7);
    expect(mockPrisma.errorLog.count).toHaveBeenCalledWith({ where: { readAt: null } });
  });
});
