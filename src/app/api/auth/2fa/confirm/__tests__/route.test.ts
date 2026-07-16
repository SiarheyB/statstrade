import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { POST } from "@/app/api/auth/2fa/confirm/route";

vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  rateLimit: vi.fn().mockReturnValue({ ok: true, retryAfterSec: 0 }),
}));

vi.mock("@/lib/crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crypto")>()),
  decrypt: vi.fn().mockReturnValue("SECRETB32"),
}));

vi.mock("@/lib/totp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/totp")>()),
  verifyTotp: vi.fn().mockReturnValue(true),
}));

const base = "https://example.com/api/auth/2fa/confirm";

describe("POST /api/auth/2fa/confirm", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue({ twoFactorSecret: "enc" });
    mockPrisma.user.update.mockResolvedValue({});
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ code: "123456" }) }));
    expect(res.status).toBe(401);
  });

  it("rejects a malformed code", async () => {
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ code: "12" }) }));
    expect(res.status).toBe(400);
  });

  it("rejects when no pending secret exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ twoFactorSecret: null });
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ code: "123456" }) }));
    expect(res.status).toBe(400);
  });

  it("rejects a wrong code", async () => {
    const totp = await import("@/lib/totp");
    (totp.verifyTotp as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ code: "000000" }) }));
    expect(res.status).toBe(400);
  });

  it("enables 2FA on the happy path", async () => {
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ code: "123456" }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ enabled: true });
    expect(mockPrisma.user.update).toHaveBeenCalledOnce();
  });
});
