import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sync", () => ({
  syncChunk: vi.fn(),
  AccountGoneError: class AccountGoneError extends Error {},
}));

import {
  asGuest,
  asUser,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { syncChunk, AccountGoneError } from "@/lib/sync";
import { POST } from "@/app/api/accounts/[id]/sync/route";

const base = "https://example.com/api/accounts/a1/sync";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockPrisma.exchangeAccount.findFirst.mockReset();
  (syncChunk as any).mockReset();
});

describe("POST /api/accounts/[id]/sync", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(new Request(base, { method: "POST" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when account not found", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue(null);
    const res = await POST(new Request(base, { method: "POST" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
  });

  it("runs a sync chunk", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1" });
    (syncChunk as any).mockResolvedValue({ status: "syncing", phase: "full" });
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ rescan: true }) }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    expect(res.status).toBe(200);
    expect(syncChunk).toHaveBeenCalledWith("a1", { rescan: true });
  });

  it("returns 400 when the account is deleted mid-sync", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1" });
    (syncChunk as any).mockRejectedValueOnce(new AccountGoneError("gone"));
    const res = await POST(new Request(base, { method: "POST" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 500 on sync error", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1" });
    (syncChunk as any).mockRejectedValueOnce(new Error("boom"));
    const res = await POST(new Request(base, { method: "POST" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(500);
  });

  // Корзины лимитера живут в модуле весь файл, поэтому у каждого теста ниже
  // СВОЙ id счёта — иначе тесты съедали бы лимит друг друга.
  describe("rate limit", () => {
    const post = (id: string, body?: object) =>
      POST(
        new Request(`https://example.com/api/accounts/${id}/sync`, {
          method: "POST",
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        { params: Promise.resolve({ id }) },
      );

    it("429 после лимита стартов сканирования", async () => {
      asUser();
      mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "rl1", syncStatus: "idle" });
      (syncChunk as any).mockResolvedValue({ status: "idle" });
      for (let i = 0; i < 10; i++) expect((await post("rl1")).status).toBe(200);
      const res = await post("rl1");
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeTruthy();
      // Сам чанк на отбитом запросе не запускается.
      expect((syncChunk as any).mock.calls).toHaveLength(10);
    });

    it("продолжения активного сканирования лимит стартов не трогает", async () => {
      asUser();
      mockPrisma.exchangeAccount.findFirst.mockResolvedValue({
        id: "rl2",
        syncStatus: "syncing",
        syncPlan: "[]",
      });
      (syncChunk as any).mockResolvedValue({ status: "syncing" });
      // Клиент гоняет чанки подряд: 50 итераций — норма, не повод для 429.
      for (let i = 0; i < 50; i++) expect((await post("rl2")).status).toBe(200);
    });

    it("rescan считается стартом, даже если сканирование идёт", async () => {
      asUser();
      mockPrisma.exchangeAccount.findFirst.mockResolvedValue({
        id: "rl3",
        syncStatus: "syncing",
        syncPlan: "[]",
      });
      (syncChunk as any).mockResolvedValue({ status: "syncing" });
      for (let i = 0; i < 10; i++) expect((await post("rl3", { rescan: true })).status).toBe(200);
      expect((await post("rl3", { rescan: true })).status).toBe(429);
    });
  });
});
