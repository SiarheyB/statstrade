import { describe, it, expect } from "vitest";
import { drawDrawings, findDrawingAt } from "@/components/DrawingOverlay";
import type { DrawingRow } from "@/lib/drawings";

const sx = (t: number) => t; // identity mapping for simplicity
const sy = (price: number) => 100 - price; // simple inverse mapping

// jsdom doesn't implement canvas 2d context without the native `canvas`
// package, so we fake the minimal surface drawDrawings touches.
function makeFakeCtx(): CanvasRenderingContext2D {
  return {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    rect: () => {},
    clip: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    arc: () => {},
    fillText: () => {},
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    setLineDash: () => {},
  } as unknown as CanvasRenderingContext2D;
}

function makeRow(overrides: Partial<DrawingRow> & { points: string; toolType: DrawingRow["toolType"] }): DrawingRow {
  return {
    id: "d1",
    userId: "u1",
    symbol: "BTCUSDT",
    exchange: "binance",
    color: "#ff0000",
    lineWidth: 2,
    fillColor: null,
    label: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe("drawDrawings", () => {
  it("does nothing when there are no drawings", () => {
    const ctx = makeFakeCtx();
    expect(() => drawDrawings(ctx, sx, sy, 0, 200, 100, [], null)).not.toThrow();
  });

  it("draws a trend_line without throwing", () => {
    const ctx = makeFakeCtx();
    const row = makeRow({
      toolType: "trend_line",
      points: JSON.stringify([{ t: 10, price: 50 }, { t: 20, price: 60 }]),
    });
    expect(() => drawDrawings(ctx, sx, sy, 0, 200, 100, [row], null)).not.toThrow();
  });

  it("draws horizontal_line, horizontal_ray, and rectangle without throwing", () => {
    const ctx = makeFakeCtx();
    const rows: DrawingRow[] = [
      makeRow({ toolType: "horizontal_line", points: JSON.stringify([{ t: 10, price: 50 }]) }),
      makeRow({ toolType: "horizontal_ray", points: JSON.stringify([{ t: 10, price: 50 }]) }),
      makeRow({
        toolType: "rectangle",
        fillColor: "#00ff00",
        points: JSON.stringify([{ t: 10, price: 50 }, { t: 30, price: 70 }]),
      }),
    ];
    expect(() => drawDrawings(ctx, sx, sy, 0, 200, 100, rows, rows[2].id)).not.toThrow();
  });

  it("skips a drawing with invalid points JSON", () => {
    const ctx = makeFakeCtx();
    const row = makeRow({ toolType: "trend_line", points: "not json" });
    expect(() => drawDrawings(ctx, sx, sy, 0, 200, 100, [row], null)).not.toThrow();
  });

  it("skips a drawing with missing points", () => {
    const ctx = makeFakeCtx();
    const row = makeRow({ toolType: "trend_line", points: "" });
    expect(() => drawDrawings(ctx, sx, sy, 0, 200, 100, [row], null)).not.toThrow();
  });

  it("skips an offscreen horizontal line", () => {
    const ctx = makeFakeCtx();
    // sy(price) = 100 - price; price=500 => y = -400, way above plotH -> offscreen
    const row = makeRow({ toolType: "horizontal_line", points: JSON.stringify([{ t: 10, price: 500 }]) });
    expect(() => drawDrawings(ctx, sx, sy, 0, 200, 100, [row], null)).not.toThrow();
  });
});

describe("findDrawingAt", () => {
  it("hits a trend_line near the segment", () => {
    const row = makeRow({
      toolType: "trend_line",
      points: JSON.stringify([{ t: 0, price: 50 }, { t: 100, price: 50 }]),
    });
    // sy(50) = 50, line runs horizontally at y=50 from x=0 to x=100
    const hit = findDrawingAt(50, 50, [row], sx, sy, 0, 200, 100);
    expect(hit).toEqual({ id: "d1", pointIdx: -1 });
  });

  it("misses when far from the line", () => {
    const row = makeRow({
      toolType: "trend_line",
      points: JSON.stringify([{ t: 0, price: 50 }, { t: 100, price: 50 }]),
    });
    const hit = findDrawingAt(50, 90, [row], sx, sy, 0, 200, 100);
    expect(hit).toBeNull();
  });

  it("hits a rectangle corner handle", () => {
    const row = makeRow({
      toolType: "rectangle",
      points: JSON.stringify([{ t: 10, price: 50 }, { t: 60, price: 80 }]),
    });
    // x0=10,x1=60; y0=min(sy(50)=50, sy(80)=20)=20, y1=50 -> BL corner=(10,50) is index 2
    const hit = findDrawingAt(10, 50, [row], sx, sy, 0, 200, 100);
    expect(hit).toEqual({ id: "d1", pointIdx: 2 });
  });

  it("hits a rectangle edge (not a corner)", () => {
    const row = makeRow({
      toolType: "rectangle",
      points: JSON.stringify([{ t: 10, price: 50 }, { t: 60, price: 80 }]),
    });
    // top edge is y=min(50,20)=20 from x=10..60, midpoint x=35
    const hit = findDrawingAt(35, 20, [row], sx, sy, 0, 200, 100);
    expect(hit).toEqual({ id: "d1", pointIdx: -1 });
  });

  it("returns null when there are no drawings", () => {
    expect(findDrawingAt(10, 10, [], sx, sy, 0, 200, 100)).toBeNull();
  });

  it("skips drawings with invalid points", () => {
    const row = makeRow({ toolType: "trend_line", points: "garbage" });
    expect(findDrawingAt(10, 10, [row], sx, sy, 0, 200, 100)).toBeNull();
  });

  it("hits a horizontal_ray only to the right of its anchor point", () => {
    const row = makeRow({
      toolType: "horizontal_ray",
      points: JSON.stringify([{ t: 50, price: 50 }]),
    });
    // ray drawn from x=50 to plotW; a point left of x=50 should miss
    expect(findDrawingAt(10, 50, [row], sx, sy, 0, 200, 100)).toBeNull();
    expect(findDrawingAt(80, 50, [row], sx, sy, 0, 200, 100)).toEqual({ id: "d1", pointIdx: 0 });
  });
});
