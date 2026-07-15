import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockTransaction: vi.fn().mockResolvedValue([]),
  mockMsgDelete: vi.fn(),
  mockTicketDelete: vi.fn(),
  mockProfileDelete: vi.fn(),
  mockUserDelete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.mockTransaction,
    supportMessage: { deleteMany: mocks.mockMsgDelete },
    supportTicket: { deleteMany: mocks.mockTicketDelete },
    riskProfile: { deleteMany: mocks.mockProfileDelete },
    user: { delete: mocks.mockUserDelete },
  },
}));

import { deleteUserCascade } from "@/lib/deleteUser";

describe("deleteUserCascade", () => {
  it("clears orphaned rows then the user inside one transaction", async () => {
    await deleteUserCascade("u1");

    expect(mocks.mockTransaction).toHaveBeenCalledTimes(1);
    const ops = mocks.mockTransaction.mock.calls[0][0];
    expect(ops).toHaveLength(4);

    expect(mocks.mockMsgDelete).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(mocks.mockTicketDelete).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(mocks.mockProfileDelete).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(mocks.mockUserDelete).toHaveBeenCalledWith({ where: { id: "u1" } });
  });
});
