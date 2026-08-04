import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getFeatureConfig: vi.fn(),
  isAdminEmail: vi.fn(),
}));

vi.mock("@/lib/featureConfig", () => ({
  getFeatureConfig: mocks.getFeatureConfig,
}));

vi.mock("@/lib/admin", () => ({
  isAdminEmail: mocks.isAdminEmail,
}));

import { forexAccessError } from "@/lib/forexAccess";
import type { SessionPayload } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
});

function user(email = "user@example.com"): SessionPayload {
  return { email } as SessionPayload;
}

describe("forexAccessError", () => {
  it("returns 403 when forex feature disabled, even for admin", async () => {
    mocks.getFeatureConfig.mockImplementation(async (key: string) =>
      key === "forex" ? { enabled: false } : { enabled: true },
    );
    mocks.isAdminEmail.mockReturnValue(true);
    const res = await forexAccessError(user());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("returns 403 for non-admin when forexPublicAccess disabled", async () => {
    mocks.getFeatureConfig.mockImplementation(async (key: string) =>
      key === "forex" ? { enabled: true } : { enabled: false },
    );
    mocks.isAdminEmail.mockReturnValue(false);
    const res = await forexAccessError(user());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("allows admin even when forexPublicAccess disabled", async () => {
    mocks.getFeatureConfig.mockImplementation(async (key: string) =>
      key === "forex" ? { enabled: true } : { enabled: false },
    );
    mocks.isAdminEmail.mockReturnValue(true);
    const res = await forexAccessError(user());
    expect(res).toBeNull();
  });

  it("allows non-admin when both flags enabled", async () => {
    mocks.getFeatureConfig.mockResolvedValue({ enabled: true });
    mocks.isAdminEmail.mockReturnValue(false);
    const res = await forexAccessError(user());
    expect(res).toBeNull();
  });
});
