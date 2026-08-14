import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { PUT } from "@/app/api/annotations/route";

vi.mock("@/lib/statsCache", () => ({
  bumpStatsVersion: vi.fn(),
}));

// Augment shared prisma mock with the tradeAnnotation upsert the route calls.
mockPrisma.tradeAnnotation = {
  ...mockPrisma.tradeAnnotation,
  upsert: vi.fn().mockResolvedValue({}),
};

const base = "https://example.com/api/annotations";

const mockAnnotation = {
  userId: "u1",
  tradeKey: "trade-1",
  entryPoint: "breakout",
  entryType: "market",
  mistake: null,
  pattern: "double_top",
  stopLoss: 49000,
  note: "good entry",
};

describe("PUT /api/annotations", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    // mockClear, а не только mockResolvedValue: иначе «не вызывался» видит
    // вызовы из предыдущих тестов файла.
    mockPrisma.tradeAnnotation.upsert.mockClear();
    mockPrisma.tradeAnnotation.upsert.mockResolvedValue(mockAnnotation as any);
    mockPrisma.exchangeAccount.findUnique.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await PUT(new Request(base, {
      method: "PUT",
      body: JSON.stringify({ tradeKey: "trade-1" }),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid body (missing tradeKey)", async () => {
    asUser();
    const res = await PUT(new Request(base, {
      method: "PUT",
      body: JSON.stringify({ entryPoint: "breakout" }),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on malformed JSON", async () => {
    asUser();
    const res = await PUT(new Request(base, {
      method: "PUT",
      body: "{not json",
    }));
    expect(res.status).toBe(400);
  });

  it("upserts annotation on valid body", async () => {
    asUser();
    const res = await PUT(new Request(base, {
      method: "PUT",
      body: JSON.stringify({
        tradeKey: "trade-1",
        entryPoint: "breakout",
        entryType: "market",
        pattern: "double_top",
        stopLoss: 49000,
        note: "good entry",
      }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tradeKey).toBe("trade-1");
    expect(body.entryPoint).toBe("breakout");
    expect(body.pattern).toBe("double_top");
    expect(mockPrisma.tradeAnnotation.upsert).toHaveBeenCalledOnce();
  });

  // ─── Чужой tradeKey (SECURITY_AUDIT.md) ───────────────────────────────────
  // Ключ принимался любой, и пересчёт RR уходил в чужой аккаунт: перезаписывал
  // чужой Trade.rr и пересобирал чужие часовые агрегаты.
  it("не даёт записать аннотацию на сделку чужого аккаунта", async () => {
    asUser();
    mockPrisma.exchangeAccount.findUnique.mockResolvedValue({ userId: "someone-else" } as never);
    const res = await PUT(
      new Request(base, {
        method: "PUT",
        body: JSON.stringify({ tradeKey: "acc-чужой:42", stopLoss: 100 }),
      }),
    );
    expect(res.status).toBe(400);
    expect(mockPrisma.tradeAnnotation.upsert).not.toHaveBeenCalled();
  });

  it("свою сделку аннотировать по-прежнему можно", async () => {
    asUser();
    mockPrisma.exchangeAccount.findUnique.mockResolvedValue({ userId: "u1" } as never);
    const res = await PUT(
      new Request(base, {
        method: "PUT",
        body: JSON.stringify({ tradeKey: "acc-1:42", pattern: "double_top" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.tradeAnnotation.upsert).toHaveBeenCalled();
  });

  it("несуществующий аккаунт не блокирует сохранение", async () => {
    asUser();
    mockPrisma.exchangeAccount.findUnique.mockResolvedValue(null as never);
    const res = await PUT(
      new Request(base, {
        method: "PUT",
        body: JSON.stringify({ tradeKey: "нет-такого", note: "x" }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
