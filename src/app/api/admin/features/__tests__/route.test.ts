import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asGuest,
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockGetAuthUser,
  mockRecordAudit,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, PATCH } from "@/app/api/admin/features/route";
import * as featureConfig from "@/lib/featureConfig";

const base = "https://example.com/api/admin/features";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockGetAdminSession.mockReset();
  mockRecordAudit.mockReset();
  featureConfig.getFeatureConfig.mockReset();
  featureConfig.setFeatureConfig.mockReset();
  featureConfig.getAllFeatureConfigs.mockReset();
});

describe("GET /api/admin/features", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns features for admin", async () => {
    asAdmin();
    asGuest();
    featureConfig.getAllFeatureConfigs.mockResolvedValue([
      { key: "playbooks", enabled: true, config: {} },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.features)).toBe(true);
  });
});

describe("PATCH /api/admin/features", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await PATCH(
      new Request(base, {
        method: "PATCH",
        body: JSON.stringify({ key: "news", enabled: true }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for unknown feature key", async () => {
    asAdmin();
    asGuest();
    const res = await PATCH(
      new Request(base, {
        method: "PATCH",
        body: JSON.stringify({ key: "not_a_feature", enabled: true }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on malformed JSON body", async () => {
    asAdmin();
    asGuest();
    const res = await PATCH(
      new Request(base, {
        method: "PATCH",
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("sets a feature config for admin", async () => {
    asAdmin();
    asGuest();
    featureConfig.setFeatureConfig.mockResolvedValueOnce(undefined);
    featureConfig.getAllFeatureConfigs.mockResolvedValueOnce([
      { key: "playbooks", enabled: false, config: {} },
    ]);
    const res = await PATCH(
      new Request(base, {
        method: "PATCH",
        body: JSON.stringify({ key: "playbooks", enabled: false }),
      }),
    );
    expect(res.status).toBe(200);
    expect(featureConfig.setFeatureConfig).toHaveBeenCalledWith("playbooks", {
      enabled: false,
      config: undefined,
    });
    expect(mockRecordAudit).toHaveBeenCalled();
  });
});
