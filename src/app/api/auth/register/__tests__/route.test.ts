import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { POST } from "@/app/api/auth/register/route";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  hashPassword: vi.fn().mockResolvedValue("hashed"),
  createSessionCookie: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  rateLimit: vi.fn().mockReturnValue({ ok: true, retryAfterSec: 0 }),
}));

vi.mock("@/lib/turnstile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/turnstile")>()),
  verifyTurnstile: vi.fn().mockResolvedValue(true),
}));

const base = "https://example.com/api/auth/register";

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.user.findUnique.mockResolvedValue(null);
    if (!("create" in mockPrisma.user)) {
      (mockPrisma.user as any).create = vi.fn();
    }
    mockPrisma.user.create.mockResolvedValue({
      id: "u-new",
      email: "new@example.com",
      name: null,
      tokenVersion: 0,
    });
    vi.clearAllMocks();
  });

  it("validates the request body (badRequest on invalid email)", async () => {
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ email: "not-an-email", password: "short" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a too-short password", async () => {
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ email: "new@example.com", password: "short" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a filled honeypot field (bot)", async () => {
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({
          email: "new@example.com",
          password: "longenough123",
          website: "spam",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the email is already registered", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u-old" });
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ email: "taken@example.com", password: "longenough123" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a user on the happy path", async () => {
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ email: "new@example.com", password: "longenough123", name: "Neo" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("u-new");
    expect(body.email).toBe("new@example.com");
    expect(mockPrisma.user.create).toHaveBeenCalledOnce();
  });

  it("returns 429 when rate-limited", async () => {
    const { rateLimit } = await import("@/lib/ratelimit");
    (rateLimit as ReturnType<typeof vi.fn>).mockReturnValue({ ok: false, retryAfterSec: 900 });
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ email: "new@example.com", password: "longenough123" }),
      }),
    );
    expect(res.status).toBe(429);
  });
});
