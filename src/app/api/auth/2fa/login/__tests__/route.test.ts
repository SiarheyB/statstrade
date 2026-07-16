import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { POST } from "@/app/api/auth/2fa/login/route";
import * as auth from "@/lib/auth";

vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  rateLimit: vi.fn().mockReturnValue({ ok: true, retryAfterSec: 0 }),
  clientIp: vi.fn().mockReturnValue("1.2.3.4"),
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getPendingUserId: vi.fn().mockResolvedValue("u1"),
  createSessionCookie: vi.fn().mockResolvedValue(undefined),
  clearPendingCookie: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crypto")>()),
  decrypt: vi.fn().mockReturnValue("SECRETB32"),
}));

vi.mock("@/lib/totp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/totp")>()),
  verifyTotp: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/sync", () => ({
  kickUserSync: vi.fn(),
}));

const base = "https://example.com/api/auth/2fa/login";

describe("POST /api/auth/2fa/login", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    (auth.getPendingUserId as ReturnType<typeof vi.fn>).mockResolvedValue("u1");
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "user@example.com",
      name: "Neo",
      twoFactorEnabled: true,
      twoFactorSecret: "enc",
      tokenVersion: 0,
    });
    vi.clearAllMocks();
  });

  it("rejects a malformed code", async () => {
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ code: "12" }) }));
    expect(res.status).toBe(400);
  });

  it("rejects when the pending session expired", async () => {
    (auth.getPendingUserId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ code: "123456" }) }));
    expect(res.status).toBe(400);
  });

  it("rejects a wrong code", async () => {
    const totp = await import("@/lib/totp");
    (totp.verifyTotp as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ code: "000000" }) }));
    expect(res.status).toBe(400);
  });

  it("issues a session on the happy path", async () => {
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ code: "123456" }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("u1");
    expect(body.email).toBe("user@example.com");
    expect(auth.createSessionCookie).toHaveBeenCalledOnce();
  });
});
