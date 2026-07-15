import { describe, it, expect, vi, afterEach } from "vitest";

const mockJwtVerify = vi.fn();

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}));

import { verifyGoogleCredential, GoogleAuthError } from "@/lib/google";

describe("verifyGoogleCredential", () => {
  afterEach(() => {
    mockJwtVerify.mockReset();
    delete process.env.GOOGLE_CLIENT_ID;
  });

  it("throws not-configured when GOOGLE_CLIENT_ID is unset", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    await expect(verifyGoogleCredential("tok")).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it("throws on an invalid token", async () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    mockJwtVerify.mockRejectedValueOnce(new Error("bad"));
    await expect(verifyGoogleCredential("tok")).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it("throws when the email is not verified", async () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    mockJwtVerify.mockResolvedValueOnce({
      payload: { email: "a@b.com", email_verified: false, sub: "s" },
    });
    await expect(verifyGoogleCredential("tok")).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it("returns the identity (email lowercased) for a valid token", async () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    mockJwtVerify.mockResolvedValueOnce({
      payload: { email: "A@B.com", email_verified: true, sub: "sub1", name: "Al" },
    });
    const id = await verifyGoogleCredential("tok");
    expect(id).toEqual({ email: "a@b.com", googleId: "sub1", name: "Al" });
  });
});
