import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asGuest,
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockGetAuthUser,
  mockRecordAudit,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { POST } from "@/app/api/admin/accounts/route";

vi.mock("@/lib/sync", () => ({ syncChunk: vi.fn().mockResolvedValue({ done: true }) }));

const base = "https://example.com/api/admin/accounts";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockGetAdminSession.mockReset();
  mockRecordAudit.mockReset();
  mockPrisma.exchangeAccount.findUnique.mockResolvedValue(null);
  mockPrisma.exchangeAccount.update.mockResolvedValue({});
});

describe("POST /api/admin/accounts", () => {
  it("returns 404 (notFound) when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ id: "x", action: "reset" }) }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when id or action missing", async () => {
    asAdmin();
    asGuest();
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ id: "x" }) }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when account not found", async () => {
    asAdmin();
    asGuest();
    mockPrisma.exchangeAccount.findUnique.mockResolvedValue(null);
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ id: "missing", action: "reset" }) }));
    expect(res.status).toBe(400);
  });

  it("resets a hanging sync status for admin", async () => {
    asAdmin();
    asGuest();
    mockPrisma.exchangeAccount.findUnique.mockResolvedValue({ id: "acc-1", exchange: "bybit", label: "Main", source: "exchange" });
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ id: "acc-1", action: "reset" }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockPrisma.exchangeAccount.update).toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalled();
  });

  it("returns 400 for sync on non-exchange account", async () => {
    asAdmin();
    asGuest();
    mockPrisma.exchangeAccount.findUnique.mockResolvedValue({ id: "acc-1", exchange: "manual", label: "Manual", source: "manual" });
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ id: "acc-1", action: "sync" }) }));
    expect(res.status).toBe(400);
  });
});
