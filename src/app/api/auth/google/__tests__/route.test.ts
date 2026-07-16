import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { POST } from "@/app/api/auth/google/route";

vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  rateLimit: vi.fn().mockReturnValue({ ok: true, retryAfterSec: 0 }),
  clientIp: vi.fn().mockReturnValue("1.2.3.4"),
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  createSessionCookie: vi.fn().mockResolvedValue(undefined),
  createPendingCookie: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/google")>()),
  verifyGoogleCredential: vi.fn().mockResolvedValue({
    email: "g@example.com",
    googleId: "gid-1",
    name: "Googler",
  }),
  GoogleAuthError: class GoogleAuthError extends Error {},
}));

vi.mock("@/lib/sync", () => ({
  kickUserSync: vi.fn(),
}));

const base = "https://example.com/api/auth/google";

describe("POST /api/auth/google", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    if (!("findFirst" in mockPrisma.user)) {
      (mockPrisma.user as any).findFirst = vi.fn();
      (mockPrisma.user as any).create = vi.fn();
    }
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: "u-new",
      email: "g@example.com",
      name: "Googler",
      googleId: "gid-1",
      twoFactorEnabled: false,
      twoFactorSecret: null,
      tokenVersion: 0,
    });
    vi.clearAllMocks();
  });

  it("rejects a malformed credential", async () => {
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ credential: "short" }) }));
    expect(res.status).toBe(400);
  });

  it("requires a JSON body", async () => {
    const res = await POST(new Request(base, { method: "POST", body: "not-json" }));
    expect(res.status).toBe(400);
  });

  it("creates a new user when none exists", async () => {
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ credential: "valid-credential-token" }) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("u-new");
    expect(body.email).toBe("g@example.com");
    expect(mockPrisma.user.create).toHaveBeenCalledOnce();
  });

  it("returns twoFactorRequired when 2FA is enabled", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "u-old",
      email: "g@example.com",
      name: "Googler",
      googleId: "gid-1",
      twoFactorEnabled: true,
      twoFactorSecret: "enc",
      tokenVersion: 0,
    });
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ credential: "valid-credential-token" }) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.twoFactorRequired).toBe(true);
  });

  it("links googleId to an existing email-only user", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "u-old",
      email: "g@example.com",
      name: "Googler",
      googleId: null,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      tokenVersion: 0,
    });
    mockPrisma.user.update.mockResolvedValue({
      id: "u-old",
      email: "g@example.com",
      name: "Googler",
      googleId: "gid-1",
      twoFactorEnabled: false,
      twoFactorSecret: null,
      tokenVersion: 0,
    });
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ credential: "valid-credential-token" }) }),
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledOnce();
  });
});
