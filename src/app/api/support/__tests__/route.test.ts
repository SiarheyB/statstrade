import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST } from "@/app/api/support/route";

vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn(() => ({ ok: true, retryAfterSec: 0 })),
  clientIp: vi.fn(() => "127.0.0.1"),
}));

import * as ratelimit from "@/lib/ratelimit";

// Augment shared prisma mock with the support models.
mockPrisma.supportTicket = {
  findMany: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({}),
};
mockPrisma.supportMessage = {
  groupBy: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
};

const base = "https://example.com/api/support";

const mockTicket = {
  id: "t-1",
  userId: "u1",
  subject: "Help",
  status: "open",
  createdAt: new Date(),
  lastMessageAt: new Date(),
};

describe("GET /api/support", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.supportTicket.findMany.mockResolvedValue([mockTicket as any]);
    mockPrisma.supportMessage.groupBy.mockResolvedValue([{ ticketId: "t-1", _count: { _all: 2 } }] as any);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns tickets with unread counts", async () => {
    asUser();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tickets)).toBe(true);
    expect(body.tickets[0].id).toBe("t-1");
    expect(body.tickets[0].unread).toBe(2);
  });
});

describe("POST /api/support", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(ratelimit.rateLimit).mockReturnValue({ ok: true, retryAfterSec: 0 });
    mockPrisma.supportTicket.create.mockResolvedValue(mockTicket as any);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(new Request(base, {
      method: "POST",
      body: JSON.stringify({ message: "Need help" }),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on empty message", async () => {
    asUser();
    const res = await POST(new Request(base, {
      method: "POST",
      body: JSON.stringify({ message: "   " }),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    asUser();
    vi.mocked(ratelimit.rateLimit).mockReturnValue({ ok: false, retryAfterSec: 42 });
    const res = await POST(new Request(base, {
      method: "POST",
      body: JSON.stringify({ message: "Need help" }),
    }));
    expect(res.status).toBe(429);
  });

  it("creates a ticket on valid message", async () => {
    asUser();
    const res = await POST(new Request(base, {
      method: "POST",
      body: JSON.stringify({ message: "First line\nrest" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticket.id).toBe("t-1");
    expect(mockPrisma.supportTicket.create).toHaveBeenCalledOnce();
  });
});
