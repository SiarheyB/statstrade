import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/statsCache", () => ({ bumpStatsVersion: vi.fn() }));

import {
  asGuest,
  asUser,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { PATCH, DELETE } from "@/app/api/accounts/[id]/route";

const base = "https://example.com/api/accounts/a1";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockPrisma.exchangeAccount.findFirst.mockReset();
  mockPrisma.exchangeAccount.update.mockReset();
  mockPrisma.exchangeAccount.delete.mockReset();
});

describe("PATCH /api/accounts/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await PATCH(
      new Request(base, { method: "PATCH", body: JSON.stringify({ autoSync: false }) }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when account not found", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue(null);
    const res = await PATCH(
      new Request(base, { method: "PATCH", body: JSON.stringify({ autoSync: false }) }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("updates auto-sync settings", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1" });
    mockPrisma.exchangeAccount.update.mockResolvedValue({ autoSync: false, syncIntervalMinutes: 120 });
    const res = await PATCH(
      new Request(base, { method: "PATCH", body: JSON.stringify({ autoSync: false, syncIntervalMinutes: 120 }) }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.autoSync).toBe(false);
  });
});

describe("DELETE /api/accounts/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await DELETE(new Request(base, { method: "DELETE" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when account not found", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue(null);
    const res = await DELETE(new Request(base, { method: "DELETE" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
  });

  it("deletes account", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1" });
    mockPrisma.exchangeAccount.delete.mockResolvedValue({});
    const res = await DELETE(new Request(base, { method: "DELETE" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
