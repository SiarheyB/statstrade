import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, PUT, DELETE } from "@/app/api/playbooks/route";

vi.mock("@/lib/featureConfig", () => ({
  getFeatureConfig: vi.fn(),
}));

import * as featureConfig from "@/lib/featureConfig";

// Augment shared prisma mock with models this route touches (routeMocks.ts is
// not edited; the shared object reference lets us add vi.fns per-test file).
mockPrisma.playbook = {
  findMany: vi.fn().mockResolvedValue([]),
  findUnique: vi.fn().mockResolvedValue(null),
  count: vi.fn().mockResolvedValue(0),
  upsert: vi.fn().mockResolvedValue({}),
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
};

const base = "https://example.com/api/playbooks";

const mockPlaybook = {
  id: "pb-1",
  userId: "u1",
  name: "Scalping",
  rules: "rule 1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("GET /api/playbooks", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: true, maxPerUser: 10 } as any);
    mockPrisma.playbook.findMany.mockResolvedValue([mockPlaybook as any]);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 404 when feature disabled", async () => {
    asUser();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: false, maxPerUser: 0 } as any);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns playbooks for the user", async () => {
    asUser();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.playbooks)).toBe(true);
    expect(body.playbooks.length).toBe(1);
    expect(body.maxPerUser).toBe(10);
  });
});

describe("PUT /api/playbooks", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: true, maxPerUser: 10 } as any);
    mockPrisma.playbook.findUnique.mockResolvedValue(null as any);
    mockPrisma.playbook.count.mockResolvedValue(0);
    mockPrisma.playbook.upsert.mockResolvedValue(mockPlaybook as any);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await PUT(new Request(base, {
      method: "PUT",
      body: JSON.stringify({ name: "Scalping", rules: "rule 1" }),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid body (missing name)", async () => {
    asUser();
    const res = await PUT(new Request(base, {
      method: "PUT",
      body: JSON.stringify({ rules: "rule 1" }),
    }));
    expect(res.status).toBe(400);
  });

  it("upserts a playbook on valid body", async () => {
    asUser();
    const res = await PUT(new Request(base, {
      method: "PUT",
      body: JSON.stringify({ name: "Scalping", rules: "rule 1" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.playbook.name).toBe("Scalping");
    expect(mockPrisma.playbook.upsert).toHaveBeenCalledOnce();
  });
});

describe("DELETE /api/playbooks", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.playbook.deleteMany.mockResolvedValue({ count: 1 } as any);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await DELETE(new Request(`${base}?name=Scalping`));
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    asUser();
    const res = await DELETE(new Request(base));
    expect(res.status).toBe(400);
  });

  it("deletes playbook by name", async () => {
    asUser();
    const res = await DELETE(new Request(`${base}?name=Scalping`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockPrisma.playbook.deleteMany).toHaveBeenCalledOnce();
  });
});
