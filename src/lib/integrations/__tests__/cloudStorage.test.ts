import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace(/^enc:/, "")),
  refreshGoogle: vi.fn(),
  refreshYandex: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    cloudStorageAccount: {
      findUnique: mocks.findUnique,
      update: mocks.update,
      findMany: mocks.findMany,
    },
  },
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: mocks.encrypt,
  decrypt: mocks.decrypt,
}));

vi.mock("@/lib/integrations/googleDrive", () => ({
  refreshAccessToken: mocks.refreshGoogle,
}));

vi.mock("@/lib/integrations/yandexDisk", () => ({
  refreshAccessToken: mocks.refreshYandex,
}));

import { getValidCloudToken, firstConnectedProvider, PROVIDER_PRIORITY } from "@/lib/integrations/cloudStorage";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.encrypt.mockImplementation((s: string) => `enc:${s}`);
  mocks.decrypt.mockImplementation((s: string) => s.replace(/^enc:/, ""));
});

describe("getValidCloudToken", () => {
  it("returns null when account not connected", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const token = await getValidCloudToken("u1", "google_drive");
    expect(token).toBeNull();
  });

  it("returns decrypted access token when not expiring soon", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "acc1",
      accessToken: "enc:tok123",
      refreshToken: "enc:refresh1",
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const token = await getValidCloudToken("u1", "google_drive");
    expect(token).toBe("tok123");
    expect(mocks.refreshGoogle).not.toHaveBeenCalled();
  });

  it("refreshes google_drive token when expiring within 60s and persists new values", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "acc1",
      accessToken: "enc:oldtok",
      refreshToken: "enc:refresh1",
      expiresAt: new Date(Date.now() - 1000),
    });
    mocks.refreshGoogle.mockResolvedValue({
      access_token: "newtok",
      refresh_token: "newrefresh",
      expires_in: 3600,
      token_type: "Bearer",
    });
    const token = await getValidCloudToken("u1", "google_drive");
    expect(token).toBe("newtok");
    expect(mocks.refreshGoogle).toHaveBeenCalledWith("refresh1");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "acc1" },
      data: expect.objectContaining({
        accessToken: "enc:newtok",
        refreshToken: "enc:newrefresh",
      }),
    });
  });

  it("refreshes yandex_disk token via yandex refresh function", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "acc2",
      accessToken: "enc:oldtok",
      refreshToken: "enc:refresh2",
      expiresAt: new Date(Date.now() - 1000),
    });
    mocks.refreshYandex.mockResolvedValue({
      access_token: "ynewtok",
      refresh_token: "ynewrefresh",
      expires_in: 1800,
      token_type: "OAuth",
    });
    const token = await getValidCloudToken("u1", "yandex_disk");
    expect(token).toBe("ynewtok");
    expect(mocks.refreshYandex).toHaveBeenCalledWith("refresh2");
  });

  it("keeps old refresh token when provider does not return a new one", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "acc1",
      accessToken: "enc:oldtok",
      refreshToken: "enc:refresh1",
      expiresAt: new Date(Date.now() - 1000),
    });
    mocks.refreshGoogle.mockResolvedValue({
      access_token: "newtok",
      expires_in: 3600,
      token_type: "Bearer",
    });
    await getValidCloudToken("u1", "google_drive");
    const data = mocks.update.mock.calls[0][0].data;
    expect(data.refreshToken).toBeUndefined();
  });
});

describe("firstConnectedProvider", () => {
  it("returns null when nothing connected", async () => {
    mocks.findMany.mockResolvedValue([]);
    const p = await firstConnectedProvider("u1");
    expect(p).toBeNull();
  });

  it("prefers google_drive over yandex_disk per PROVIDER_PRIORITY", async () => {
    mocks.findMany.mockResolvedValue([{ provider: "yandex_disk" }, { provider: "google_drive" }]);
    const p = await firstConnectedProvider("u1");
    expect(p).toBe("google_drive");
    expect(PROVIDER_PRIORITY[0]).toBe("google_drive");
  });

  it("falls back to yandex_disk when google_drive not connected", async () => {
    mocks.findMany.mockResolvedValue([{ provider: "yandex_disk" }]);
    const p = await firstConnectedProvider("u1");
    expect(p).toBe("yandex_disk");
  });
});
