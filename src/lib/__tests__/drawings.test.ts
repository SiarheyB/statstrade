import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    userDrawing: {
      create: mocks.create,
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      update: mocks.update,
      delete: mocks.delete,
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
  type CreateDrawingInput,
} from "@/lib/drawings";

beforeEach(() => {
  vi.clearAllMocks();
});

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
    await expect(createDrawing(validInput({ userId: "" }))).rejects.toThrow("userId is required");
  });

  it("rejects missing symbol", async () => {
    await expect(createDrawing(validInput({ symbol: "" }))).rejects.toThrow("symbol is required");
  });

  it("rejects missing exchange", async () => {
    await expect(createDrawing(validInput({ exchange: "" }))).rejects.toThrow("exchange is required");
  });

  it("rejects invalid toolType", async () => {
    await expect(
      createDrawing(validInput({ toolType: "circle" as any })),
    ).rejects.toThrow(/invalid toolType/);
  });

  it("rejects empty points array", async () => {
    await expect(createDrawing(validInput({ points: [] }))).rejects.toThrow(
      "points must be a non-empty array",
    );
  });

  it("rejects points missing t/price", async () => {
    await expect(
      createDrawing(validInput({ points: [{ t: "x", price: 1 } as any] })),
    ).rejects.toThrow(/each point must have/);
  });

  it("rejects out-of-range lineWidth", async () => {
    await expect(createDrawing(validInput({ lineWidth: 0 }))).rejects.toThrow(
      /lineWidth must be an integer/,
    );
    await expect(createDrawing(validInput({ lineWidth: 11 }))).rejects.toThrow(
      /lineWidth must be an integer/,
    );
    await expect(createDrawing(validInput({ lineWidth: 1.5 }))).rejects.toThrow(
      /lineWidth must be an integer/,
    );
  });

  it("accepts all DRAWING_TOOLS types", async () => {
    mocks.create.mockResolvedValue({ id: "d1" });
    for (const t of DRAWING_TOOLS) {
      await expect(createDrawing(validInput({ toolType: t }))).resolves.toBeDefined();
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
    mocks.findFirst.mockResolvedValue({ id: "d1" });
    await expect(updateDrawing("d1", "u1", { lineWidth: 20 })).rejects.toThrow(
      /lineWidth must be an integer/,
    );
  });

  it("updates only provided fields", async () => {
    mocks.findFirst.mockResolvedValue({ id: "d1" });
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
    mocks.findFirst.mockResolvedValue({ id: "d1" });
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
