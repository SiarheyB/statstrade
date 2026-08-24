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

/** Тот же фейк, но с записью кружков-маркеров: по ним проверяем, где именно
 *  оказались ручки прямоугольника. */
function makeRecordingCtx(): { ctx: CanvasRenderingContext2D; arcs: Array<[number, number]> } {
  const arcs: Array<[number, number]> = [];
  const ctx = makeFakeCtx();
  (ctx as unknown as { arc: (x: number, y: number) => void }).arc = (x, y) => { arcs.push([x, y]); };
  return { ctx, arcs };
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
    showPrice: true,
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

  it("draws 4 corner + 4 side handles for a rectangle", () => {
    const { ctx, arcs } = makeRecordingCtx();
    // x0=10,x1=60,y0=20,y1=50 -> середины (10,35),(60,35),(35,20),(35,50)
    const row = makeRow({
      toolType: "rectangle",
      points: JSON.stringify([{ t: 10, price: 50 }, { t: 60, price: 80 }]),
    });
    drawDrawings(ctx, sx, sy, 0, 200, 100, [row], null);
    expect(arcs).toEqual([
      [10, 20], [60, 20], [10, 50], [60, 50],
      [10, 35], [60, 35], [35, 20], [35, 50],
    ]);
  });

  it("draws only corner handles when the rectangle sides are too short", () => {
    const { ctx, arcs } = makeRecordingCtx();
    const row = makeRow({
      toolType: "rectangle",
      points: JSON.stringify([{ t: 10, price: 50 }, { t: 30, price: 70 }]),
    });
    drawDrawings(ctx, sx, sy, 0, 200, 100, [row], null);
    expect(arcs).toHaveLength(4);
  });

  it("рисует ярлык цены уровня на шкале в цвете уровня", () => {
    const calls: Array<{ text: string; x: number }> = [];
    const ctx = makeFakeCtx();
    const fills: string[] = [];
    (ctx as unknown as { fillText: (t: string, x: number) => void }).fillText = (text, x) => {
      calls.push({ text, x });
      fills.push(ctx.fillStyle as string);
    };
    const layout = { plotX: 0, plotW: 200, plotH: 100, W: 264, H: 120 };
    const row = makeRow({
      toolType: "horizontal_line",
      color: "#a855f7",
      points: JSON.stringify([{ t: 10, price: 4765.5 }]),
    });
    drawDrawings(ctx, sx, (p) => 100 - (p - 4700) / 10, 0, 200, 100, [row], null, layout);
    // ярлык рисуется правее области графика (на ценовой шкале)
    expect(calls.some((c) => c.text === "4,766" && c.x > layout.plotX + layout.plotW)).toBe(true);
  });

  it("не рисует ярлык, если цена выключена или нет layout", () => {
    const texts: string[] = [];
    const ctx = makeFakeCtx();
    (ctx as unknown as { fillText: (t: string) => void }).fillText = (t) => { texts.push(t); };
    const layout = { plotX: 0, plotW: 200, plotH: 100, W: 264, H: 120 };
    const off = makeRow({
      toolType: "horizontal_ray",
      showPrice: false,
      points: JSON.stringify([{ t: 10, price: 50 }]),
    });
    drawDrawings(ctx, sx, sy, 0, 200, 100, [off], null, layout);
    expect(texts).toHaveLength(0);

    // без layout (вызов из старого кода) — тоже молча без ярлыка
    const on = makeRow({ toolType: "horizontal_ray", points: JSON.stringify([{ t: 10, price: 50 }]) });
    drawDrawings(ctx, sx, sy, 0, 200, 100, [on], null);
    expect(texts).toHaveLength(0);
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
    expect(hit).toEqual({ id: "d1", pointIdx: -1, toolType: "trend_line" });
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
    expect(hit).toEqual({ id: "d1", pointIdx: 2, toolType: "rectangle" });
  });

  it("hits the side mid-handles (4=left, 5=right, 6=top, 7=bottom)", () => {
    const row = makeRow({
      toolType: "rectangle",
      points: JSON.stringify([{ t: 10, price: 50 }, { t: 60, price: 80 }]),
    });
    // x0=10,x1=60,y0=20,y1=50 -> середины сторон: (10,35),(60,35),(35,20),(35,50)
    expect(findDrawingAt(10, 35, [row], sx, sy, 0, 200, 100)).toEqual({ id: "d1", pointIdx: 4, toolType: "rectangle" });
    expect(findDrawingAt(60, 35, [row], sx, sy, 0, 200, 100)).toEqual({ id: "d1", pointIdx: 5, toolType: "rectangle" });
    expect(findDrawingAt(35, 20, [row], sx, sy, 0, 200, 100)).toEqual({ id: "d1", pointIdx: 6, toolType: "rectangle" });
    expect(findDrawingAt(35, 50, [row], sx, sy, 0, 200, 100)).toEqual({ id: "d1", pointIdx: 7, toolType: "rectangle" });
  });

  it("has no mid-handles on a small rectangle (sides under the minimum)", () => {
    // 20x20 px — обе стороны короче MID_HANDLE_MIN_SIDE: в середине верхней
    // стороны должен быть обычный контур (перенос), а не ручка ресайза.
    const row = makeRow({
      toolType: "rectangle",
      points: JSON.stringify([{ t: 10, price: 50 }, { t: 30, price: 70 }]),
    });
    expect(findDrawingAt(20, 30, [row], sx, sy, 0, 200, 100)).toEqual({ id: "d1", pointIdx: -1, toolType: "rectangle" });
  });

  it("hits a rectangle edge (not a handle)", () => {
    const row = makeRow({
      toolType: "rectangle",
      points: JSON.stringify([{ t: 10, price: 50 }, { t: 60, price: 80 }]),
    });
    // top edge is y=min(50,20)=20 from x=10..60; берём точку в стороне от
    // середины (x=35) и от углов
    const hit = findDrawingAt(24, 20, [row], sx, sy, 0, 200, 100);
    expect(hit).toEqual({ id: "d1", pointIdx: -1, toolType: "rectangle" });
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
    expect(findDrawingAt(80, 50, [row], sx, sy, 0, 200, 100)).toEqual({ id: "d1", pointIdx: 0, toolType: "horizontal_ray" });
  });
});
