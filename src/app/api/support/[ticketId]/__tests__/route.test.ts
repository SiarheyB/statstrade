import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST, PATCH } from "@/app/api/support/[ticketId]/route";

vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn(() => ({ ok: true, retryAfterSec: 0 })),
  clientIp: vi.fn(() => "127.0.0.1"),
}));

import * as ratelimit from "@/lib/ratelimit";

const base = "https://example.com/api/support";

const mockTicket = {
  id: "t-1",
  userId: "u1",
  subject: "Help",
  status: "open",
  createdAt: new Date(),
  lastMessageAt: new Date(),
};

const mockMsg = {
  id: "m-1",
  ticketId: "t-1",
  userId: "u1",
  authorRole: "user",
  email: "user@example.com",
  message: "reply",
  createdAt: new Date(),
};

// Augment shared prisma mock with the support models.
mockPrisma.supportTicket = {
  findFirst: vi.fn().mockResolvedValue(null),
  update: vi.fn().mockResolvedValue({}),
};
mockPrisma.supportMessage = {
  findMany: vi.fn().mockResolvedValue([]),
  updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  create: vi.fn().mockResolvedValue(mockMsg as any),
};
mockPrisma.$transaction = vi.fn().mockResolvedValue([]);

describe("GET /api/support/[ticketId]", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.supportTicket.findFirst.mockResolvedValue(mockTicket as any);
    mockPrisma.supportMessage.findMany.mockResolvedValue([mockMsg as any]);
    mockPrisma.supportMessage.updateMany.mockResolvedValue({ count: 1 } as any);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}/t-1`), { params: Promise.resolve({ ticketId: "t-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 when ticket not found", async () => {
    asUser();
    mockPrisma.supportTicket.findFirst.mockResolvedValue(null as any);
    const res = await GET(new Request(`${base}/nope`), { params: Promise.resolve({ ticketId: "nope" }) });
    expect(res.status).toBe(400);
  });

  it("returns ticket and messages", async () => {
    asUser();
    const res = await GET(new Request(`${base}/t-1`), { params: Promise.resolve({ ticketId: "t-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticket.id).toBe("t-1");
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages[0].id).toBe("m-1");
  });
});

describe("POST /api/support/[ticketId]", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(ratelimit.rateLimit).mockReturnValue({ ok: true, retryAfterSec: 0 });
    mockPrisma.supportTicket.findFirst.mockResolvedValue(mockTicket as any);
    mockPrisma.$transaction.mockResolvedValue([mockMsg as any, mockTicket as any]);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(new Request(`${base}/t-1`, {
      method: "POST",
      body: JSON.stringify({ message: "reply" }),
    }), { params: Promise.resolve({ ticketId: "t-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 when ticket not found", async () => {
    asUser();
    mockPrisma.supportTicket.findFirst.mockResolvedValue(null as any);
    const res = await POST(new Request(`${base}/nope`, {
      method: "POST",
      body: JSON.stringify({ message: "reply" }),
    }), { params: Promise.resolve({ ticketId: "nope" }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when ticket is closed", async () => {
    asUser();
    mockPrisma.supportTicket.findFirst.mockResolvedValue({ ...mockTicket, status: "closed" } as any);
    const res = await POST(new Request(`${base}/t-1`, {
      method: "POST",
      body: JSON.stringify({ message: "reply" }),
    }), { params: Promise.resolve({ ticketId: "t-1" }) });
    expect(res.status).toBe(400);
  });

  it("appends a message to an open ticket", async () => {
    asUser();
    const res = await POST(new Request(`${base}/t-1`, {
      method: "POST",
      body: JSON.stringify({ message: "reply" }),
    }), { params: Promise.resolve({ ticketId: "t-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message.id).toBe("m-1");
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
  });
});

describe("PATCH /api/support/[ticketId]", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.supportTicket.findFirst.mockResolvedValue(mockTicket as any);
    mockPrisma.supportTicket.update.mockResolvedValue({ ...mockTicket, status: "closed", closedAt: new Date() } as any);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await PATCH(new Request(`${base}/t-1`, { method: "PATCH" }), { params: Promise.resolve({ ticketId: "t-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 when ticket not found", async () => {
    asUser();
    mockPrisma.supportTicket.findFirst.mockResolvedValue(null as any);
    const res = await PATCH(new Request(`${base}/nope`, { method: "PATCH" }), { params: Promise.resolve({ ticketId: "nope" }) });
    expect(res.status).toBe(400);
  });

  it("closes an open ticket", async () => {
    asUser();
    const res = await PATCH(new Request(`${base}/t-1`, { method: "PATCH" }), { params: Promise.resolve({ ticketId: "t-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticket.status).toBe("closed");
  });
});
