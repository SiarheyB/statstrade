import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sync", () => ({
  syncChunk: vi.fn(),
}));

import {
  asGuest,
  asUser,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { syncChunk } from "@/lib/sync";
import { POST } from "@/app/api/accounts/[id]/sync/route";

const base = "https://example.com/api/accounts/a1/sync";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockPrisma.exchangeAccount.findFirst.mockReset();
  (syncChunk as any).mockReset();
});

describe("POST /api/accounts/[id]/sync", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(new Request(base, { method: "POST" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when account not found", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue(null);
    const res = await POST(new Request(base, { method: "POST" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
  });

  it("runs a sync chunk", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1" });
    (syncChunk as any).mockResolvedValue({ status: "syncing", phase: "full" });
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ rescan: true }) }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    expect(res.status).toBe(200);
    expect(syncChunk).toHaveBeenCalledWith("a1", { rescan: true });
  });

  it("returns 500 on sync error", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1" });
    (syncChunk as any).mockRejectedValueOnce(new Error("boom"));
    const res = await POST(new Request(base, { method: "POST" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(500);
  });
});
