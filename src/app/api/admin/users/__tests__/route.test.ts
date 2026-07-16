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
import { POST, DELETE } from "@/app/api/admin/users/route";

const base = "https://example.com/api/admin/users";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockGetAdminSession.mockReset();
  mockRecordAudit.mockReset();
  mockPrisma.user.findUnique.mockReset();
  mockPrisma.user.update.mockReset();
});

describe("POST /api/admin/users", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ id: "u1", action: "reset2fa" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when id or action missing", async () => {
    asAdmin();
    asGuest();
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ id: "u1" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("resets 2FA for admin", async () => {
    asAdmin();
    asGuest();
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.com" });
    mockPrisma.user.update.mockResolvedValue({});
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ id: "u1", action: "reset2fa" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" } }),
    );
    expect(mockRecordAudit).toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/users", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await DELETE(new Request(`${base}?id=u1`));
    expect(res.status).toBe(404);
  });

  it("returns 400 when id missing", async () => {
    asAdmin();
    asGuest();
    const res = await DELETE(new Request(base));
    expect(res.status).toBe(400);
  });

  it("returns 400 when deleting self", async () => {
    asAdmin();
    asGuest();
    mockPrisma.user.findUnique.mockResolvedValue({ id: "a1", email: "admin@x.com" });
    const res = await DELETE(new Request(`${base}?id=a1`));
    expect(res.status).toBe(400);
  });
});
