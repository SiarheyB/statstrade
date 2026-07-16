import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { POST } from "@/app/api/auth/2fa/setup/route";

vi.mock("@/lib/crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crypto")>()),
  encrypt: vi.fn().mockReturnValue("enc-secret"),
}));

vi.mock("@/lib/totp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/totp")>()),
  generateSecret: vi.fn().mockReturnValue("SECRETB32"),
  otpauthURL: vi.fn().mockReturnValue("otpauth://totp/..."),
}));

const base = "https://example.com/api/auth/2fa/setup";

describe("POST /api/auth/2fa/setup", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    asUser({ email: "user@example.com" });
    mockPrisma.user.findUnique.mockResolvedValue({ twoFactorEnabled: false });
    mockPrisma.user.update.mockResolvedValue({});
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(new Request(base, { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("rejects when 2FA is already enabled", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ twoFactorEnabled: true });
    const res = await POST(new Request(base, { method: "POST" }));
    expect(res.status).toBe(400);
  });

  it("returns secret, otpauth and qr on the happy path", async () => {
    const res = await POST(new Request(base, { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.secret).toBe("SECRETB32");
    expect(body.otpauth).toBe("otpauth://totp/...");
    expect(typeof body.qr).toBe("string");
    expect(mockPrisma.user.update).toHaveBeenCalledOnce();
  });
});
