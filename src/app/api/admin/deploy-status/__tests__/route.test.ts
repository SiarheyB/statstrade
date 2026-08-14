import { describe, it, expect, vi, beforeEach } from "vitest";
import { asAdmin, asNonAdmin, mockGetAdminSession } from "@/lib/__tests__/helpers/routeMocks";

vi.mock("@/lib/deployStatus", () => ({
  getDeployStatus: vi.fn(),
}));

import { getDeployStatus } from "@/lib/deployStatus";
import { GET } from "@/app/api/admin/deploy-status/route";

describe("GET /api/admin/deploy-status", () => {
  beforeEach(() => {
    mockGetAdminSession.mockReset();
    vi.mocked(getDeployStatus).mockReset();
  });

  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns the deploy status for an admin", async () => {
    asAdmin();
    vi.mocked(getDeployStatus).mockResolvedValue({
      available: true,
      runningSha: "abc123",
      runningShaShort: "abc123",
      latestSha: "abc123",
      latestShaShort: "abc123",
      upToDate: true,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upToDate).toBe(true);
  });
});
