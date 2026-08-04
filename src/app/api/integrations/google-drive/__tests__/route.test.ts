import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";

vi.mock("@/lib/crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crypto")>()),
  decrypt: vi.fn().mockReturnValue("decrypted-token"),
}));

vi.mock("@/lib/integrations/googleDrive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/googleDrive")>()),
  isGoogleDriveConfigured: vi.fn(),
  revokeToken: vi.fn(),
}));

import { GET, DELETE } from "@/app/api/integrations/google-drive/route";
import { isGoogleDriveConfigured, revokeToken } from "@/lib/integrations/googleDrive";
import { decrypt } from "@/lib/crypto";

describe("GET /api/integrations/google-drive", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.clearAllMocks();
    asUser();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns configured=false when not configured on server", async () => {
    (isGoogleDriveConfigured as any).mockReturnValue(false);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ configured: false, connected: false });
  });

  it("returns connected=false when configured but no account", async () => {
    (isGoogleDriveConfigured as any).mockReturnValue(true);
    mockPrisma.cloudStorageAccount.findUnique.mockResolvedValue(null);
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ configured: true, connected: false, email: null });
  });

  it("returns connected=true with email when account exists", async () => {
    (isGoogleDriveConfigured as any).mockReturnValue(true);
    mockPrisma.cloudStorageAccount.findUnique.mockResolvedValue({ accountEmail: "a@b.com" });
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ configured: true, connected: true, email: "a@b.com" });
  });
});

describe("DELETE /api/integrations/google-drive", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.clearAllMocks();
    asUser();
    (decrypt as any).mockReturnValue("decrypted-token");
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("is a no-op ok when no account is connected", async () => {
    mockPrisma.cloudStorageAccount.findUnique.mockResolvedValue(null);
    const res = await DELETE();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("revokes token and deletes account on happy path", async () => {
    mockPrisma.cloudStorageAccount.findUnique.mockResolvedValue({
      id: "acc1",
      refreshToken: "enc-token",
    });
    (revokeToken as any).mockResolvedValue(undefined);
    mockPrisma.cloudStorageAccount.delete.mockResolvedValue({});

    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(revokeToken).toHaveBeenCalledWith("decrypted-token");
    expect(mockPrisma.cloudStorageAccount.delete).toHaveBeenCalledWith({ where: { id: "acc1" } });
  });

  it("returns 500 when revoke fails", async () => {
    mockPrisma.cloudStorageAccount.findUnique.mockResolvedValue({
      id: "acc1",
      refreshToken: "enc-token",
    });
    (revokeToken as any).mockRejectedValue(new Error("revoke failed"));

    const res = await DELETE();
    expect(res.status).toBe(500);
  });
});
