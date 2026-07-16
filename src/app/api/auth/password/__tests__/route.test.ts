import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, PUT } from "@/app/api/auth/password/route";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  hashPassword: vi.fn().mockResolvedValue("hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
  createSessionCookie: vi.fn().mockResolvedValue(undefined),
  invalidateTokenVersionCache: vi.fn(),
}));

const base = "https://example.com/api/auth/password";

describe("GET /api/auth/password", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.user.findUnique.mockResolvedValue({ password: "hash" });
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("reports hasPassword=true when a password exists", async () => {
    asUser();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ hasPassword: true });
  });

  it("reports hasPassword=false for a Google-only account", async () => {
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue({ password: null });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasPassword).toBe(false);
  });
});

describe("PUT /api/auth/password", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue({ password: "hash" });
    mockPrisma.user.update.mockResolvedValue({ tokenVersion: 1 });
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await PUT(new Request(base, { method: "PUT", body: JSON.stringify({ newPassword: "longenough123" }) }));
    expect(res.status).toBe(401);
  });

  it("rejects a too-short new password", async () => {
    const res = await PUT(new Request(base, { method: "PUT", body: JSON.stringify({ newPassword: "short" }) }));
    expect(res.status).toBe(400);
  });

  it("rejects a wrong current password", async () => {
    const auth = await import("@/lib/auth");
    (auth.verifyPassword as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const res = await PUT(
      new Request(base, { method: "PUT", body: JSON.stringify({ currentPassword: "wrong", newPassword: "longenough123" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("changes the password on the happy path", async () => {
    const res = await PUT(
      new Request(base, { method: "PUT", body: JSON.stringify({ currentPassword: "currentlong123", newPassword: "longenough123" }) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ hasPassword: true });
    expect(mockPrisma.user.update).toHaveBeenCalledOnce();
  });

  it("allows setting a first password without currentPassword", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ password: null });
    const res = await PUT(
      new Request(base, { method: "PUT", body: JSON.stringify({ newPassword: "longenough123" }) }),
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledOnce();
  });
});
