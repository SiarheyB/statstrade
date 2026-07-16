import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asGuest,
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockGetAuthUser,
  mockRecordAudit,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST, PATCH } from "@/app/api/admin/support/[ticketId]/route";

const base = "https://example.com/api/admin/support/t1";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockGetAdminSession.mockReset();
  mockRecordAudit.mockReset();
  mockPrisma.supportTicket.findUnique.mockReset();
  mockPrisma.supportMessage.findMany.mockReset();
  mockPrisma.supportMessage.updateMany.mockReset();
  mockPrisma.supportMessage.create.mockReset();
  mockPrisma.supportTicket.update.mockReset();
  mockPrisma.user.findUnique.mockReset();
  mockPrisma.$transaction.mockReset();
});

describe("GET /api/admin/support/[ticketId]", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await GET(new Request(base), { params: Promise.resolve({ ticketId: "t1" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 when ticket not found", async () => {
    asAdmin();
    asGuest();
    mockPrisma.supportTicket.findUnique.mockResolvedValue(null);
    const res = await GET(new Request(base), { params: Promise.resolve({ ticketId: "t1" }) });
    expect(res.status).toBe(400);
  });

  it("returns ticket + messages for admin", async () => {
    asAdmin();
    asGuest();
    mockPrisma.supportTicket.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      subject: "Help",
      status: "open",
    });
    mockPrisma.supportMessage.findMany.mockResolvedValue([{ id: "m1", message: "hi" }]);
    mockPrisma.user.findUnique.mockResolvedValue({ email: "a@b.com", name: "A" });
    const res = await GET(new Request(base), { params: Promise.resolve({ ticketId: "t1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticket.id).toBe("t1");
    expect(Array.isArray(body.messages)).toBe(true);
  });
});

describe("POST /api/admin/support/[ticketId]", () => {
  it("returns 400 on empty message", async () => {
    asAdmin();
    asGuest();
    mockPrisma.supportTicket.findUnique.mockResolvedValue({ id: "t1", userId: "u1" });
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ message: "   " }) }),
      { params: Promise.resolve({ ticketId: "t1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("posts admin reply", async () => {
    asAdmin();
    asGuest();
    mockPrisma.supportTicket.findUnique.mockResolvedValue({ id: "t1", userId: "u1" });
    mockPrisma.supportMessage.create.mockResolvedValue({ id: "m2", message: "ok" });
    mockPrisma.supportTicket.update.mockResolvedValue({ id: "t1" });
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ message: "ok" }) }),
      { params: Promise.resolve({ ticketId: "t1" }) },
    );
    expect(res.status).toBe(200);
    expect(mockRecordAudit).toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/support/[ticketId]", () => {
  it("returns 400 on invalid status", async () => {
    asAdmin();
    asGuest();
    const res = await PATCH(
      new Request(base, { method: "PATCH", body: JSON.stringify({ status: "weird" }) }),
      { params: Promise.resolve({ ticketId: "t1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("closes ticket", async () => {
    asAdmin();
    asGuest();
    mockPrisma.supportTicket.findUnique.mockResolvedValue({ id: "t1", userId: "u1" });
    mockPrisma.supportTicket.update.mockResolvedValue({ id: "t1", status: "closed" });
    const res = await PATCH(
      new Request(base, { method: "PATCH", body: JSON.stringify({ status: "closed" }) }),
      { params: Promise.resolve({ ticketId: "t1" }) },
    );
    expect(res.status).toBe(200);
    expect(mockRecordAudit).toHaveBeenCalled();
  });
});
