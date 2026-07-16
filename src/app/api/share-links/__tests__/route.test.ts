import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST, DELETE } from "@/app/api/share-links/route";

vi.mock("@/lib/featureConfig", () => ({
  getFeatureConfig: vi.fn(),
}));
vi.mock("@/lib/mentorShare", () => ({
  generateShareToken: vi.fn(() => "tok123"),
}));

import * as featureConfig from "@/lib/featureConfig";

// Augment shared prisma mock with the shareLink model.
mockPrisma.shareLink = {
  findMany: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
  create: vi.fn().mockResolvedValue({}),
  updateMany: vi.fn().mockResolvedValue({ count: 0 }),
};

const base = "https://example.com/api/share-links";

const mockLink = {
  id: "link-1",
  userId: "u1",
  token: "tok123",
  label: "Mentor link",
  revokedAt: null,
  createdAt: new Date(),
};

describe("GET /api/share-links", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: true, maxLinksPerUser: 5 } as any);
    mockPrisma.shareLink.findMany.mockResolvedValue([mockLink as any]);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 404 when mentorMode feature disabled", async () => {
    asUser();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: false, maxLinksPerUser: 0 } as any);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns links for the user", async () => {
    asUser();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.links)).toBe(true);
    expect(body.links.length).toBe(1);
    expect(body.maxLinksPerUser).toBe(5);
  });
});

describe("POST /api/share-links", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: true, maxLinksPerUser: 5 } as any);
    mockPrisma.shareLink.count.mockResolvedValue(0);
    mockPrisma.shareLink.create.mockResolvedValue(mockLink as any);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(new Request(base, { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when limit reached", async () => {
    asUser();
    mockPrisma.shareLink.count.mockResolvedValue(5);
    const res = await POST(new Request(base, { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
  });

  it("creates a share link on valid request", async () => {
    asUser();
    const res = await POST(new Request(base, {
      method: "POST",
      body: JSON.stringify({ label: "Mentor link" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.link.token).toBe("tok123");
    expect(mockPrisma.shareLink.create).toHaveBeenCalledOnce();
  });
});

describe("DELETE /api/share-links", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.shareLink.updateMany.mockResolvedValue({ count: 1 } as any);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await DELETE(new Request(`${base}?id=link-1`));
    expect(res.status).toBe(401);
  });

  it("returns 400 when id is missing", async () => {
    asUser();
    const res = await DELETE(new Request(base));
    expect(res.status).toBe(400);
  });

  it("revokes a share link by id", async () => {
    asUser();
    const res = await DELETE(new Request(`${base}?id=link-1`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockPrisma.shareLink.updateMany).toHaveBeenCalledOnce();
  });
});
