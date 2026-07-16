import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { POST } from "@/app/api/auth/login/route";
import * as authModule from "@/lib/auth";
import * as ratelimitModule from "@/lib/ratelimit";

vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn().mockReturnValue({ ok: true, retryAfterSec: 0 }),
  clientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/sync", () => ({
  kickUserSync: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    verifyPassword: vi.fn(),
    createSessionCookie: vi.fn(),
    createPendingCookie: vi.fn(),
    clearSessionCookie: vi.fn(),
  };
});

const base = "https://example.com/api/auth/login";

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.user.findUnique.mockReset();
    ratelimitModule.rateLimit.mockReturnValue({ ok: true, retryAfterSec: 0 });
    authModule.verifyPassword.mockReset();
    authModule.createSessionCookie.mockReset();
    authModule.createPendingCookie.mockReset();
  });

  it("returns 400 when body is malformed", async () => {
    asUser();
    const res = await POST(
      new Request(base, { method: "POST", body: "not-json" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when email/password missing", async () => {
    asUser();
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({}) })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when email invalid", async () => {
    asUser();
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ email: "invalid", password: "password" }) })
    );
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate limit exceeded", async () => {
    asUser();
    ratelimitModule.rateLimit.mockReturnValue({ ok: false, retryAfterSec: 60 });
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ email: "test@example.com", password: "password" }) })
    );
    expect(res.status).toBe(429);
  });

  it("returns 400 with invalid credentials", async () => {
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1", email: "test@example.com", password: "hashed", twoFactorEnabled: false, twoFactorSecret: null, name: "Test User", tokenVersion: 1 });
    authModule.verifyPassword.mockResolvedValue(false);
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ email: "test@example.com", password: "wrong" }) })
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 with successful login (no 2FA)", async () => {
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1", email: "test@example.com", password: "hashed", twoFactorEnabled: false, twoFactorSecret: null, name: "Test User", tokenVersion: 1 });
    authModule.verifyPassword.mockResolvedValue(true);
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ email: "test@example.com", password: "password" }) })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    expect(body.email).toBe("test@example.com");
  });

  it("returns 200 with twoFactorRequired flag", async () => {
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      password: "hashed",
      twoFactorEnabled: true,
      twoFactorSecret: "secret",
      name: "Test User",
      tokenVersion: 1,
    });
    authModule.verifyPassword.mockResolvedValue(true);
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ email: "test@example.com", password: "password" }) })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.twoFactorRequired).toBe(true);
  });

  it("returns 500 when unexpected error occurs", async () => {
    asUser();
    ratelimitModule.rateLimit.mockReturnValue({ ok: true, retryAfterSec: 0 });
    mockPrisma.user.findUnique.mockRejectedValueOnce(new Error("Database error"));
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ email: "test@example.com", password: "password" }) })
    );
    expect(res.status).toBe(500);
  });
});