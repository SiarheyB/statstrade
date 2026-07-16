import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST, DELETE } from "@/app/api/auth/google/link/route";

vi.mock("@/lib/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/google")>()),
  verifyGoogleCredential: vi.fn().mockResolvedValue({
    email: "g@example.com",
    googleId: "gid-1",
    name: "Googler",
  }),
  GoogleAuthError: class GoogleAuthError extends Error {},
}));

const base = "https://example.com/api/auth/google/link";

describe("GET /api/auth/google/link", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue({ googleId: "gid-1", password: "hash" });
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("reports linked=true when a googleId exists", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ linked: true, hasPassword: true });
  });

  it("reports linked=false for an unlinked account", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ googleId: null, password: null });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.linked).toBe(false);
  });
});

describe("POST /api/auth/google/link", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.update.mockResolvedValue({});
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ credential: "valid-credential-token" }) }));
    expect(res.status).toBe(401);
  });

  it("rejects a malformed credential", async () => {
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ credential: "short" }) }));
    expect(res.status).toBe(400);
  });

  it("rejects when the Google account is linked to another user", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "other" });
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ credential: "valid-credential-token" }) }));
    expect(res.status).toBe(400);
  });

  it("links the Google account on the happy path", async () => {
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ credential: "valid-credential-token" }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ linked: true, email: "g@example.com" });
    expect(mockPrisma.user.update).toHaveBeenCalledOnce();
  });
});

describe("DELETE /api/auth/google/link", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue({ password: "hash" });
    mockPrisma.user.update.mockResolvedValue({});
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("requires a password before unlinking", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ password: null });
    const res = await DELETE();
    expect(res.status).toBe(400);
  });

  it("unlinks the Google account on the happy path", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ linked: false });
    expect(mockPrisma.user.update).toHaveBeenCalledOnce();
  });
});
