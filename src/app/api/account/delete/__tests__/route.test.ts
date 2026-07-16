import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  verifyPassword: vi.fn(async () => true),
  clearSessionCookie: vi.fn(),
}));
vi.mock("@/lib/deleteUser", () => ({
  deleteUserCascade: vi.fn(async () => {}),
}));

import {
  asGuest,
  asUser,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { verifyPassword, clearSessionCookie } from "@/lib/auth";
import { deleteUserCascade } from "@/lib/deleteUser";
import { DELETE } from "@/app/api/account/delete/route";

const base = "https://example.com/api/account/delete";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockPrisma.user.findUnique.mockReset();
  (verifyPassword as any).mockReset();
  (verifyPassword as any).mockResolvedValue(true);
  (clearSessionCookie as any).mockReset();
  (deleteUserCascade as any).mockReset();
  (deleteUserCascade as any).mockResolvedValue(undefined);
});

describe("DELETE /api/account/delete", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await DELETE(new Request(base, { method: "DELETE" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when user not found", async () => {
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await DELETE(
      new Request(base, { method: "DELETE", body: JSON.stringify({ password: "pw" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on wrong password", async () => {
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue({ password: "hashed" });
    (verifyPassword as any).mockResolvedValueOnce(false);
    const res = await DELETE(
      new Request(base, { method: "DELETE", body: JSON.stringify({ password: "bad" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("deletes user account", async () => {
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue({ password: "hashed" });
    const res = await DELETE(
      new Request(base, { method: "DELETE", body: JSON.stringify({ password: "pw" }) }),
    );
    expect(res.status).toBe(200);
    expect(clearSessionCookie).toHaveBeenCalled();
  });
});
