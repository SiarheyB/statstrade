import { describe, it, expect, beforeEach, vi } from "vitest";
import { asUser, asGuest, mockGetAuthUser, mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/donate/route";

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,abc"),
  },
}));

describe("GET /api/donate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockReset();
    asUser();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns wallets with qr codes on happy path", async () => {
    mockPrisma.donateWallet.findMany.mockResolvedValue([
      { id: "1", network: "TRC20", coin: "USDT", address: "Txxx", enabled: true, sortOrder: 0 },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wallets).toEqual([
      { id: "1", network: "TRC20", coin: "USDT", address: "Txxx", qr: "data:image/png;base64,abc" },
    ]);
    expect(mockPrisma.donateWallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true } }),
    );
  });

  it("returns 500 when prisma throws", async () => {
    mockPrisma.donateWallet.findMany.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
