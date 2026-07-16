import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asGuest,
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockGetAuthUser,
  mockRecordAudit,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, DELETE } from "@/app/api/admin/errors/route";

const base = "https://example.com/api/admin/errors";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockGetAdminSession.mockReset();
  mockRecordAudit.mockReset();
  mockPrisma.errorLog.findMany.mockResolvedValue([]);
  mockPrisma.errorLog.count.mockResolvedValue(0);
  mockPrisma.errorLog.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.errorLog.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.errorLog.delete.mockResolvedValue({});
});

describe("GET /api/admin/errors", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns errors and marks them read for admin", async () => {
    asAdmin();
    asGuest();
    mockPrisma.errorLog.findMany.mockResolvedValue([{ id: "e1", message: "boom", createdAt: new Date(), readAt: null }]);
    mockPrisma.errorLog.count.mockResolvedValue(1);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(mockPrisma.errorLog.updateMany).toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/errors", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await DELETE(new Request(base, { method: "DELETE", body: JSON.stringify({ id: "e1" }) }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when neither id nor all provided", async () => {
    asAdmin();
    asGuest();
    const res = await DELETE(new Request(base, { method: "DELETE", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  it("deletes all errors for admin", async () => {
    asAdmin();
    asGuest();
    const res = await DELETE(new Request(base, { method: "DELETE", body: JSON.stringify({ all: true }) }));
    expect(res.status).toBe(200);
    expect(mockPrisma.errorLog.deleteMany).toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalled();
  });

  it("deletes a single error for admin", async () => {
    asAdmin();
    asGuest();
    const res = await DELETE(new Request(base, { method: "DELETE", body: JSON.stringify({ id: "e1" }) }));
    expect(res.status).toBe(200);
    expect(mockPrisma.errorLog.delete).toHaveBeenCalled();
  });
});
