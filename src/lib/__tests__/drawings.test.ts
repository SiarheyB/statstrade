import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  count: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    userDrawing: {
      create: mocks.create,
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      update: mocks.update,
      delete: mocks.delete,
      count: mocks.count,
      deleteMany: mocks.deleteMany,
    },
  },
}));

import {
  createDrawing,
  getDrawings,
  getDrawingById,
  updateDrawing,
  deleteDrawing,
  hardDeleteDrawing,
  DRAWING_TOOLS,
  MAX_DRAWINGS_PER_USER,
  type CreateDrawingInput,
} from "@/lib/drawings";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.count.mockResolvedValue(0);
  mocks.deleteMany.mockResolvedValue({ count: 0 });
});

const POINTS: Record<string, { t: number; price: number }[]> = {
  trend_line: [{ t: 1, price: 100 }, { t: 2, price: 110 }],
  rectangle: [{ t: 1, price: 100 }, { t: 2, price: 110 }],
  horizontal_line: [{ t: 1, price: 100 }],
  horizontal_ray: [{ t: 1, price: 100 }],
};

function validInput(over: Partial<CreateDrawingInput> = {}): CreateDrawingInput {
  return {
    userId: "u1",
    symbol: "btcusdt",
    exchange: "binance",
    toolType: "trend_line",
    points: [{ t: 1, price: 100 }, { t: 2, price: 110 }],
    ...over,
  };
}

describe("createDrawing validation", () => {
  it("rejects missing userId", async () => {
    await expect(createDrawing(validInput({ userId: "" }))).rejects.toThrow(/invalid userId/);
  });

  it("rejects missing symbol", async () => {
    await expect(createDrawing(validInput({ symbol: "" }))).rejects.toThrow(/invalid symbol/);
  });

  it("rejects missing exchange", async () => {
    await expect(createDrawing(validInput({ exchange: "" }))).rejects.toThrow(/invalid exchange/);
  });

  it("rejects invalid toolType", async () => {
    await expect(
      createDrawing(validInput({ toolType: "circle" as any })),
    ).rejects.toThrow(/invalid toolType/);
  });

  it("rejects empty points array", async () => {
    await expect(createDrawing(validInput({ points: [] }))).rejects.toThrow(/invalid points/);
  });

  it("rejects points missing t/price", async () => {
    await expect(
      createDrawing(validInput({ points: [{ t: "x", price: 1 } as any] })),
    ).rejects.toThrow(/invalid points/);
  });

  it("rejects out-of-range lineWidth", async () => {
    await expect(createDrawing(validInput({ lineWidth: 0 }))).rejects.toThrow(/invalid lineWidth/);
    await expect(createDrawing(validInput({ lineWidth: 11 }))).rejects.toThrow(/invalid lineWidth/);
    await expect(createDrawing(validInput({ lineWidth: 1.5 }))).rejects.toThrow(/invalid lineWidth/);
  });

  it("accepts all DRAWING_TOOLS types with their own point count", async () => {
    mocks.create.mockResolvedValue({ id: "d1" });
    for (const t of DRAWING_TOOLS) {
      const points = POINTS[t];
      await expect(createDrawing(validInput({ toolType: t, points }))).resolves.toBeDefined();
    }
  });
});

describe("createDrawing success", () => {
  it("uppercases symbol and applies defaults", async () => {
    mocks.create.mockResolvedValue({ id: "d1" });
    await createDrawing(validInput());
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        symbol: "BTCUSDT",
        color: "#e6b800",
        lineWidth: 2,
        fillColor: null,
        label: null,
        points: JSON.stringify([{ t: 1, price: 100 }, { t: 2, price: 110 }]),
      }),
    });
  });

  it("passes through explicit optional fields", async () => {
    mocks.create.mockResolvedValue({ id: "d1" });
    await createDrawing(validInput({ color: "#fff", lineWidth: 4, fillColor: "#000", label: "hi" }));
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ color: "#fff", lineWidth: 4, fillColor: "#000", label: "hi" }),
    });
  });
});

describe("getDrawings", () => {
  it("filters by uppercased symbol and excludes deleted by default", async () => {
    mocks.findMany.mockResolvedValue([]);
    await getDrawings({ userId: "u1", symbol: "ethusdt", exchange: "binance" });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", symbol: "ETHUSDT", exchange: "binance", deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  });

  it("includes deleted when includeDeleted=true", async () => {
    mocks.findMany.mockResolvedValue([]);
    await getDrawings({ userId: "u1", symbol: "eth", exchange: "binance", includeDeleted: true });
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeUndefined();
  });
});

describe("getDrawingById", () => {
  it("returns row when found", async () => {
    mocks.findFirst.mockResolvedValue({ id: "d1" });
    const r = await getDrawingById("d1", "u1");
    expect(r).toEqual({ id: "d1" });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "d1", userId: "u1", deletedAt: null } });
  });

  it("returns null when not found", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const r = await getDrawingById("d1", "u1");
    expect(r).toBeNull();
  });
});

describe("updateDrawing", () => {
  it("returns null when drawing not found/owned", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const r = await updateDrawing("d1", "u1", { label: "x" });
    expect(r).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("throws on invalid lineWidth", async () => {
    mocks.findFirst.mockResolvedValue({ id: "d1", toolType: "trend_line" });
    await expect(updateDrawing("d1", "u1", { lineWidth: 20 })).rejects.toThrow(/invalid lineWidth/);
  });

  it("updates only provided fields", async () => {
    mocks.findFirst.mockResolvedValue({ id: "d1", toolType: "horizontal_line" });
    mocks.update.mockResolvedValue({ id: "d1", label: "new" });
    const r = await updateDrawing("d1", "u1", { label: "new", points: [{ t: 1, price: 2 }] });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { points: JSON.stringify([{ t: 1, price: 2 }]), label: "new" },
    });
    expect(r).toEqual({ id: "d1", label: "new" });
  });
});

describe("deleteDrawing", () => {
  it("returns false when not found/owned", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const r = await deleteDrawing("d1", "u1");
    expect(r).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("soft-deletes and returns true", async () => {
    mocks.findFirst.mockResolvedValue({ id: "d1", toolType: "trend_line" });
    mocks.update.mockResolvedValue({});
    const r = await deleteDrawing("d1", "u1");
    expect(r).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { deletedAt: expect.any(Date) },
    });
  });
});

describe("hardDeleteDrawing", () => {
  it("returns true on success", async () => {
    mocks.delete.mockResolvedValue({});
    const r = await hardDeleteDrawing("d1");
    expect(r).toBe(true);
  });

  it("returns false on error", async () => {
    mocks.delete.mockRejectedValue(new Error("not found"));
    const r = await hardDeleteDrawing("d1");
    expect(r).toBe(false);
  });
});

// ─── Потолки на ввод (SECURITY_AUDIT.md) ────────────────────────────────────
// До этого не было ни одного ограничения: ни на число точек, ни на длину
// строк, ни на количество рисунков у пользователя.

describe("лимиты на ввод", () => {
  beforeEach(() => {
    mocks.create.mockResolvedValue({ id: "d1" });
  });

  it("не даёт прислать лишние точки", async () => {
    const many = Array.from({ length: 100_000 }, (_, i) => ({ t: i, price: i }));
    await expect(createDrawing(validInput({ points: many }))).rejects.toThrow(/invalid points/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("требует ровно нужное число точек под инструмент", async () => {
    await expect(
      createDrawing(validInput({ toolType: "horizontal_line", points: POINTS.trend_line })),
    ).rejects.toThrow(/exactly 1 point/);
    await expect(
      createDrawing(validInput({ toolType: "trend_line", points: POINTS.horizontal_line })),
    ).rejects.toThrow(/exactly 2 point/);
  });

  it("режет бесконечности и NaN в точках", async () => {
    for (const bad of [Infinity, -Infinity, NaN]) {
      await expect(
        createDrawing(validInput({ points: [{ t: 1, price: bad }, { t: 2, price: 1 }] })),
      ).rejects.toThrow(/invalid points/);
    }
    await expect(
      createDrawing(validInput({ points: [{ t: 1e300, price: 1 }, { t: 2, price: 1 }] })),
    ).rejects.toThrow(/invalid points/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("ограничивает длину label", async () => {
    await expect(createDrawing(validInput({ label: "x".repeat(5000) }))).rejects.toThrow(
      /invalid label/,
    );
    await expect(createDrawing(validInput({ label: "x".repeat(100) }))).resolves.toBeDefined();
  });

  it("ограничивает длину symbol и exchange", async () => {
    await expect(createDrawing(validInput({ symbol: "A".repeat(500) }))).rejects.toThrow(
      /invalid symbol/,
    );
    await expect(createDrawing(validInput({ exchange: "b".repeat(500) }))).rejects.toThrow(
      /invalid exchange/,
    );
  });

  it("принимает только hex-цвет", async () => {
    await expect(createDrawing(validInput({ color: "javascript:alert(1)" }))).rejects.toThrow(
      /invalid color/,
    );
    await expect(createDrawing(validInput({ fillColor: "x".repeat(1000) }))).rejects.toThrow(
      /invalid fillColor/,
    );
    await expect(createDrawing(validInput({ color: "#e6b800" }))).resolves.toBeDefined();
  });

  it("упирается в потолок рисунков на пользователя", async () => {
    mocks.count.mockResolvedValue(MAX_DRAWINGS_PER_USER);
    await expect(createDrawing(validInput())).rejects.toThrow(/drawing limit reached/);
    expect(mocks.create).not.toHaveBeenCalled();

    mocks.count.mockResolvedValue(MAX_DRAWINGS_PER_USER - 1);
    await expect(createDrawing(validInput())).resolves.toBeDefined();
  });

  it("лимит считает только живые рисунки текущего пользователя", async () => {
    await createDrawing(validInput());
    expect(mocks.count).toHaveBeenCalledWith({ where: { userId: "u1", deletedAt: null } });
  });

  it("те же потолки действуют и на update", async () => {
    mocks.findFirst.mockResolvedValue({ id: "d1", toolType: "trend_line" });
    await expect(updateDrawing("d1", "u1", { label: "x".repeat(5000) })).rejects.toThrow(
      /invalid label/,
    );
    await expect(updateDrawing("d1", "u1", { color: "not-a-color" })).rejects.toThrow(
      /invalid color/,
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("удаление попутно выносит свои старые мягко удалённые строки", async () => {
    mocks.findFirst.mockResolvedValue({ id: "d1", toolType: "trend_line" });
    mocks.update.mockResolvedValue({});
    await deleteDrawing("d1", "u1");
    const arg = mocks.deleteMany.mock.calls[0][0];
    expect(arg.where.userId).toBe("u1");
    expect(arg.where.deletedAt.lt).toBeInstanceOf(Date);
    // Чужие строки не трогаем и живые тоже.
    expect(arg.where.deletedAt.lt.getTime()).toBeLessThan(Date.now());
  });
});
