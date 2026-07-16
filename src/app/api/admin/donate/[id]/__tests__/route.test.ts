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
import { PATCH, DELETE } from "@/app/api/admin/donate/[id]/route";

const base = "https://example.com/api/admin/donate";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockGetAdminSession.mockReset();
  mockRecordAudit.mockReset();
  mockPrisma.donateWallet.update.mockResolvedValue({});
  mockPrisma.donateWallet.delete.mockResolvedValue({});
  mockPrisma.donateWallet.findMany.mockResolvedValue([]);
});

describe("PATCH /api/admin/donate/[id]", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await PATCH(new Request(`${base}/w1`, { method: "PATCH", body: JSON.stringify({ enabled: false }) }), { params: Promise.resolve({ id: "w1" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 when no changes provided", async () => {
    asAdmin();
    asGuest();
    const res = await PATCH(new Request(`${base}/w1`, { method: "PATCH", body: JSON.stringify({}) }), { params: Promise.resolve({ id: "w1" }) });
    expect(res.status).toBe(400);
  });

  it("updates a wallet for admin", async () => {
    asAdmin();
    asGuest();
    const res = await PATCH(new Request(`${base}/w1`, { method: "PATCH", body: JSON.stringify({ enabled: false, coin: "USDC" }) }), { params: Promise.resolve({ id: "w1" }) });
    expect(res.status).toBe(200);
    expect(mockPrisma.donateWallet.update).toHaveBeenCalledWith({ where: { id: "w1" }, data: { enabled: false, coin: "USDC" } });
    expect(mockRecordAudit).toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/donate/[id]", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await DELETE(new Request(`${base}/w1`, { method: "DELETE" }), { params: Promise.resolve({ id: "w1" }) });
    expect(res.status).toBe(404);
  });

  it("deletes a wallet for admin", async () => {
    asAdmin();
    asGuest();
    const res = await DELETE(new Request(`${base}/w1`, { method: "DELETE" }), { params: Promise.resolve({ id: "w1" }) });
    expect(res.status).toBe(200);
    expect(mockPrisma.donateWallet.delete).toHaveBeenCalledWith({ where: { id: "w1" } });
    expect(mockRecordAudit).toHaveBeenCalled();
  });
});
