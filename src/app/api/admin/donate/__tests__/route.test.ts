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
import { GET, POST } from "@/app/api/admin/donate/route";

const base = "https://example.com/api/admin/donate";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockGetAdminSession.mockReset();
  mockRecordAudit.mockReset();
  mockPrisma.donateWallet.findMany.mockResolvedValue([]);
  mockPrisma.donateWallet.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
  mockPrisma.donateWallet.create.mockResolvedValue({});
});

describe("GET /api/admin/donate", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns wallets list for admin", async () => {
    asAdmin();
    asGuest();
    mockPrisma.donateWallet.findMany.mockResolvedValue([{ id: "w1", network: "ERC20", coin: "USDT", address: "0xabc", sortOrder: 0 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.wallets)).toBe(true);
  });
});

describe("POST /api/admin/donate", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ network: "ERC20", coin: "USDT", address: "0xabc" }) }));
    expect(res.status).toBe(404);
  });

  it("returns 400 on invalid body (zod)", async () => {
    asAdmin();
    asGuest();
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ network: "", coin: "USDT", address: "0xabc" }) }));
    expect(res.status).toBe(400);
  });

  it("creates a wallet for admin", async () => {
    asAdmin();
    asGuest();
    mockPrisma.donateWallet.create.mockResolvedValue({ id: "w1", network: "ERC20", coin: "USDT", address: "0xabc", sortOrder: 1 });
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ network: "ERC20", coin: "USDT", address: "0xabc" }) }));
    expect(res.status).toBe(200);
    expect(mockPrisma.donateWallet.create).toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalled();
  });
});
