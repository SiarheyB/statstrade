import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    announcement: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    errorLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { requireAdmin, recordAudit } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { DELETE } from "@/app/api/admin/announcements/[id]/route";

const base = "https://example.com/api/admin/announcements/1";
const mockSession = { userId: "a1", email: "admin@example.com" };

function call(id = "1") {
  return DELETE(new Request(base, { method: "DELETE" }), { params: Promise.resolve({ id }) });
}

describe("DELETE /api/admin/announcements/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession);
  });

  it("returns 401 when not an admin", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: "Admin access required" }), { status: 401 }),
    );
    const res = await call();
    expect(res.status).toBe(401);
  });

  it("returns 404 when announcement not found", async () => {
    (prisma.announcement.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("toggles active flag off and audits hide", async () => {
    (prisma.announcement.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "1",
      title: "T",
      active: true,
    });
    (prisma.announcement.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: "1" },
      data: { active: false },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      mockSession,
      "announcement.hide",
      expect.objectContaining({ targetId: "1" }),
    );
  });

  it("toggles active flag on and audits show", async () => {
    (prisma.announcement.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "1",
      title: "T",
      active: false,
    });
    (prisma.announcement.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const res = await call();
    expect(res.status).toBe(200);
    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: "1" },
      data: { active: true },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      mockSession,
      "announcement.show",
      expect.any(Object),
    );
  });

  it("returns 500 when prisma throws", async () => {
    (prisma.announcement.findUnique as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
    const res = await call();
    expect(res.status).toBe(500);
  });
});
