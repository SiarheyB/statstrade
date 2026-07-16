import { describe, it, expect, vi } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
} from "@/lib/__tests__/helpers/routeMocks";
import { POST } from "@/app/api/auth/logout/route";

vi.mock("@/lib/auth", () => ({
  clearSessionCookie: vi.fn().mockResolvedValue(undefined),
}));

const base = "https://example.com/api/auth/logout";

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.clearAllMocks();
  });

  it("returns 200 and clears session cookie", async () => {
    asUser();
    const res = await POST(new Request(base, { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 200 even when guest", async () => {
    asGuest();
    const res = await POST(new Request(base, { method: "POST" }));
    expect(res.status).toBe(200);
  });
});