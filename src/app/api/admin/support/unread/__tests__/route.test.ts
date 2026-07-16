import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asGuest,
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/admin/support/unread/route";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockGetAdminSession.mockReset();
  mockPrisma.supportMessage.count.mockReset();
});

describe("GET /api/admin/support/unread", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns 500 on count error", async () => {
    asAdmin();
    asGuest();
    mockPrisma.supportMessage.count.mockRejectedValueOnce(new Error("boom"));
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("returns unread count for admin", async () => {
    asAdmin();
    asGuest();
    mockPrisma.supportMessage.count.mockResolvedValueOnce(3);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(3);
  });
});
