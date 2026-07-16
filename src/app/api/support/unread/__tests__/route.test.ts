import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/support/unread/route";

// Augment shared prisma mock with the supportMessage model.
mockPrisma.supportMessage = {
  count: vi.fn().mockResolvedValue(0),
};

const base = "https://example.com/api/support/unread";

describe("GET /api/support/unread", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.supportMessage.count.mockResolvedValue(0);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 0 when there are no unread admin messages", async () => {
    asUser();
    mockPrisma.supportMessage.count.mockResolvedValue(0);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
  });

  it("returns the unread admin message count", async () => {
    asUser();
    mockPrisma.supportMessage.count.mockResolvedValue(3);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(3);
    const callArg = mockPrisma.supportMessage.count.mock.calls[0][0];
    expect(callArg.where.userId).toBe("u1");
    expect(callArg.where.authorRole).toBe("admin");
    expect(callArg.where.readAt).toBeNull();
  });
});
