import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    announcement: {
      create: vi.fn(),
    },
    errorLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { requireAdmin, recordAudit } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/admin/announcements/route";

const base = "https://example.com/api/admin/announcements";
const mockSession = { userId: "a1", email: "admin@example.com" };

function req(body: unknown) {
  return new Request(base, { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/admin/announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession);
  });

  it("returns 401 when not an admin", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: "Admin access required" }), { status: 401 }),
    );
    const res = await POST(req({ title: "T", body: "B" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid JSON body", async () => {
    const res = await POST(new Request(base, { method: "POST", body: "bad" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on validation failure", async () => {
    const res = await POST(req({ title: "", body: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("creates announcement on happy path", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    (prisma.announcement.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "1",
      title: "T",
      body: "B",
      createdAt,
    });
    const res = await POST(req({ title: "T", body: "B" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.announcement).toEqual({
      id: "1",
      title: "T",
      body: "B",
      createdAt: createdAt.toISOString(),
    });
    expect(recordAudit).toHaveBeenCalledWith(
      mockSession,
      "announcement.create",
      expect.objectContaining({ targetId: "1", targetLabel: "T" }),
    );
  });

  it("returns 500 when prisma throws", async () => {
    (prisma.announcement.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
    const res = await POST(req({ title: "T", body: "B" }));
    expect(res.status).toBe(500);
  });
});
