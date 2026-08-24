import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { RefObject } from "react";
import { snapToCandle, useChartInteractions, type ChartInteractionsOptions } from "@/lib/useChartInteractions";
import type { Candle } from "@/lib/candlestickChart";
import type { DrawingRow } from "@/lib/drawings";

const mocks = vi.hoisted(() => ({ findDrawingAt: vi.fn() }));
vi.mock("@/components/DrawingOverlay", () => ({
  findDrawingAt: mocks.findDrawingAt,
}));

function candle(t: number, o: number, h: number, l: number, c: number): Candle {
  return { t, o, h, l, c };
}

describe("snapToCandle", () => {
  const candles: Candle[] = [
    candle(0, 100, 110, 90, 105),
    candle(60000, 105, 115, 95, 108),
    candle(120000, 108, 120, 100, 112),
  ];

  it("passes through unchanged when magnet is off", () => {
    expect(snapToCandle(30000, 999, candles, false)).toEqual({ t: 30000, price: 999 });
  });

  it("returns input unchanged when there are no candles", () => {
    expect(snapToCandle(30000, 999, [], true)).toEqual({ t: 30000, price: 999 });
  });

  it("snaps to nearest candle's high when close to high", () => {
    // nearest candle at t=0 (o100,h110,l90,c105), range=20, threshold=12
    const r = snapToCandle(5000, 108, candles, true);
    expect(r.t).toBe(0);
    expect(r.price).toBe(110);
  });

  it("snaps to nearest candle's low when close to low", () => {
    const r = snapToCandle(5000, 92, candles, true);
    expect(r.t).toBe(0);
    expect(r.price).toBe(90);
  });

  it("keeps original price when not close enough to either high or low", () => {
    // candle at t=0 has h=110,l=90 (range 20, snap threshold 12); 200 is far
    // from both edges, so the price passes through unsnapped.
    const r = snapToCandle(5000, 200, candles, true);
    expect(r.t).toBe(0);
    expect(r.price).toBe(200);
  });

  it("does not snap time when nearest candle beyond the snap time threshold", () => {
    // step=60000, threshold=30000; t=200000 is far from nearest candle t=120000 (dist 80000)
    const r = snapToCandle(200000, 200, candles, true);
    expect(r).toEqual({ t: 200000, price: 200 });
  });

  it("handles single-candle input (step defaults to 60000)", () => {
    const single = [candle(1000, 100, 110, 90, 105)];
    const r = snapToCandle(1000, 108, single, true);
    expect(r.t).toBe(1000);
    expect(r.price).toBe(110);
  });
});

function makeOpts(overrides: Partial<ChartInteractionsOptions> = {}): ChartInteractionsOptions {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, x: 0, y: 0, toJSON() {},
  });
  const canvasRef = { current: canvas } as RefObject<HTMLCanvasElement | null>;
  return {
    canvasRef,
    getCandles: () => [],
    getDrawings: () => [],
    showDrawings: true,
    magnet: false,
    locked: false,
    activeTool: null,
    setActiveTool: vi.fn(),
    drawingPoints: [],
    setDrawingPoints: vi.fn(),
    selectedDrawingId: null,
    setSelectedDrawingId: vi.fn(),
    setShowDrawingEditor: vi.fn(),
    saveDrawing: vi.fn(),
    updateDrawing: vi.fn(),
    redraw: vi.fn(),
    ...overrides,
  };
}

function mouseEvent(canvas: HTMLElement, clientX: number, clientY: number) {
  return {
    clientX,
    clientY,
    currentTarget: canvas,
  } as unknown as React.MouseEvent<HTMLCanvasElement>;
}

function drawingRow(over: Partial<DrawingRow> = {}): DrawingRow {
  return {
    id: "d1",
    userId: "u1",
    symbol: "BTCUSDT",
    exchange: "binance",
    toolType: "trend_line",
    points: JSON.stringify([{ t: 0, price: 100 }, { t: 1000, price: 110 }]),
    color: "#e6b800",
    lineWidth: 2,
    fillColor: null,
    label: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("useChartInteractions — onDown/onMove/onUp pan flow", () => {
  it("onDown with no layout falls back to starting a pan drag from viewRef", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.viewRef.current = { t0: 0, t1: 1000, y0: 0, y1: 100 };
    });
    act(() => {
      result.current.onDown(mouseEvent(opts.canvasRef.current!, 50, 50));
    });
    expect(result.current.dragRef.current?.mode).toBe("pan");
  });

  it("onDown picks pan/zoomX/zoomY mode based on cursor position relative to layout", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.layoutRef.current = { plotX: 80, plotW: 600, plotH: 300 };
      result.current.viewRef.current = { t0: 0, t1: 100000, y0: 0, y1: 100 };
    });
    // inside plot area, not near right edge or bottom → pan
    act(() => {
      result.current.onDown(mouseEvent(opts.canvasRef.current!, 400, 100));
    });
    expect(result.current.dragRef.current?.mode).toBe("pan");

    // near right edge → zoomY
    act(() => {
      result.current.onDown(mouseEvent(opts.canvasRef.current!, 700, 100));
    });
    expect(result.current.dragRef.current?.mode).toBe("zoomY");

    // near bottom → zoomX
    act(() => {
      result.current.onDown(mouseEvent(opts.canvasRef.current!, 400, 295));
    });
    expect(result.current.dragRef.current?.mode).toBe("zoomX");
  });

  it("onMove during a pan drag updates viewRef and schedules a redraw", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.layoutRef.current = { plotX: 80, plotW: 600, plotH: 300 };
      result.current.viewRef.current = { t0: 0, t1: 100000, y0: 0, y1: 100 };
    });
    act(() => {
      result.current.onDown(mouseEvent(opts.canvasRef.current!, 400, 100));
    });
    act(() => {
      result.current.onMove(mouseEvent(opts.canvasRef.current!, 350, 100));
    });
    expect(result.current.viewRef.current?.t0).not.toBe(0);
    await vi.waitFor(() => expect(opts.redraw).toHaveBeenCalled());
  });

  it("onUp clears drag/resize refs", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.dragRef.current = { mx: 0, my: 0, mode: "pan", view: { t0: 0, t1: 1, y0: 0, y1: 1 } };
    });
    act(() => {
      result.current.onUp();
    });
    expect(result.current.dragRef.current).toBeNull();
  });
});

describe("useChartInteractions — drawing tool point creation", () => {
  it("onDown with an active horizontal_line tool saves immediately and clears the tool", () => {
    const opts = makeOpts({ activeTool: "horizontal_line" });
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.layoutRef.current = { plotX: 80, plotW: 600, plotH: 300 };
      result.current.viewRef.current = { t0: 0, t1: 100000, y0: 0, y1: 100 };
    });
    act(() => {
      result.current.onDown(mouseEvent(opts.canvasRef.current!, 400, 150));
    });
    expect(opts.saveDrawing).toHaveBeenCalledWith("horizontal_line", [
      expect.objectContaining({ t: expect.any(Number), price: expect.any(Number) }),
    ]);
    expect(opts.setActiveTool).toHaveBeenCalledWith(null);
  });

  it("onDown with trend_line tool needs two clicks: first sets a point, second saves and resets", () => {
    const opts = makeOpts({ activeTool: "trend_line", drawingPoints: [] });
    const { result, rerender } = renderHook((o) => useChartInteractions(o), { initialProps: opts });
    act(() => {
      result.current.layoutRef.current = { plotX: 80, plotW: 600, plotH: 300 };
      result.current.viewRef.current = { t0: 0, t1: 100000, y0: 0, y1: 100 };
    });
    act(() => {
      result.current.onDown(mouseEvent(opts.canvasRef.current!, 200, 100));
    });
    expect(opts.setDrawingPoints).toHaveBeenCalledWith([
      expect.objectContaining({ t: expect.any(Number), price: expect.any(Number) }),
    ]);
    expect(opts.saveDrawing).not.toHaveBeenCalled();

    // simulate the point having been stored, then click again
    const opts2 = { ...opts, drawingPoints: [{ t: 1000, price: 50 }] };
    rerender(opts2);
    act(() => {
      result.current.onDown(mouseEvent(opts.canvasRef.current!, 300, 120));
    });
    expect(opts.saveDrawing).toHaveBeenCalledWith("trend_line", [
      { t: 1000, price: 50 },
      expect.objectContaining({ t: expect.any(Number), price: expect.any(Number) }),
    ]);
    expect(opts.setDrawingPoints).toHaveBeenCalledWith([]);
    expect(opts.setActiveTool).toHaveBeenCalledWith(null);
  });
});

describe("useChartInteractions — selecting/dragging existing drawings", () => {
  it("selects a hit drawing and starts a drag (not locked)", () => {
    const drawing = drawingRow();
    mocks.findDrawingAt.mockReturnValue({ id: "d1", pointIdx: -1 });
    const opts = makeOpts({ getDrawings: () => [drawing], locked: false });
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.layoutRef.current = { plotX: 80, plotW: 600, plotH: 300 };
      result.current.viewRef.current = { t0: 0, t1: 100000, y0: 0, y1: 100 };
    });
    act(() => {
      result.current.onDown(mouseEvent(opts.canvasRef.current!, 300, 150));
    });
    expect(opts.setSelectedDrawingId).toHaveBeenCalledWith("d1");
    expect(opts.setShowDrawingEditor).toHaveBeenCalledWith(true);
    expect(result.current.dragRef.current?.drawingId).toBe("d1");
  });

  it("locked=true blocks selecting/dragging a hit drawing (falls through to pan)", () => {
    const drawing = drawingRow();
    mocks.findDrawingAt.mockReturnValue({ id: "d1", pointIdx: -1 });
    const opts = makeOpts({ getDrawings: () => [drawing], locked: true });
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.layoutRef.current = { plotX: 80, plotW: 600, plotH: 300 };
      result.current.viewRef.current = { t0: 0, t1: 100000, y0: 0, y1: 100 };
    });
    act(() => {
      result.current.onDown(mouseEvent(opts.canvasRef.current!, 300, 150));
    });
    expect(opts.setSelectedDrawingId).not.toHaveBeenCalled();
    expect(result.current.dragRef.current?.drawingId).toBeUndefined();
    expect(result.current.dragRef.current?.mode).toBe("pan");
  });

  it("rectangle corner hit sets up a resize state", () => {
    const drawing = drawingRow({
      toolType: "rectangle",
      points: JSON.stringify([{ t: 0, price: 100 }, { t: 1000, price: 50 }]),
    });
    mocks.findDrawingAt.mockReturnValue({ id: "d1", pointIdx: 0, toolType: "rectangle" });
    const opts = makeOpts({ getDrawings: () => [drawing] });
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.layoutRef.current = { plotX: 80, plotW: 600, plotH: 300 };
      result.current.viewRef.current = { t0: 0, t1: 100000, y0: 0, y1: 100 };
    });
    act(() => {
      result.current.onDown(mouseEvent(opts.canvasRef.current!, 300, 150));
    });
    expect(result.current.drawingResizeRef.current?.handleIdx).toBe(0);
  });

  it("side handle resize keeps both prices untouched (magnet on)", () => {
    const drawing = drawingRow({
      toolType: "rectangle",
      points: JSON.stringify([{ t: 0, price: 100 }, { t: 1000, price: 50 }]),
    });
    // ручка 4 — левая сторона: тянем по времени, цены обязаны остаться теми же
    mocks.findDrawingAt.mockReturnValue({ id: "d1", pointIdx: 4, toolType: "rectangle" });
    const candles: Candle[] = [
      candle(0, 100, 120, 80, 110),
      candle(1000, 110, 130, 90, 120),
    ];
    const opts = makeOpts({ getDrawings: () => [drawing], getCandles: () => candles, magnet: true });
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.layoutRef.current = { plotX: 0, plotW: 600, plotH: 300 };
      result.current.viewRef.current = { t0: 0, t1: 2000, y0: 0, y1: 200 };
    });
    act(() => {
      result.current.onDown(mouseEvent(opts.canvasRef.current!, 100, 150));
    });
    act(() => {
      result.current.onMove(mouseEvent(opts.canvasRef.current!, 250, 40));
    });
    const pts = result.current.drawingDragRef.current?.originalPoints;
    expect(pts?.[0].price).toBe(100);
    expect(pts?.[1].price).toBe(50);
    // время левой границы поехало, правая осталась на месте
    expect(pts?.[1].t).toBe(1000);
    expect(pts?.[0].t).not.toBe(0);
  });

  it("clicking empty space while a drawing is selected clears the selection", () => {
    mocks.findDrawingAt.mockReturnValue(null);
    const opts = makeOpts({ getDrawings: () => [], selectedDrawingId: "d1" });
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.layoutRef.current = { plotX: 80, plotW: 600, plotH: 300 };
      result.current.viewRef.current = { t0: 0, t1: 100000, y0: 0, y1: 100 };
    });
    act(() => {
      result.current.onDown(mouseEvent(opts.canvasRef.current!, 400, 150));
    });
    expect(opts.setSelectedDrawingId).toHaveBeenCalledWith(null);
    expect(opts.setShowDrawingEditor).toHaveBeenCalledWith(false);
  });

  it("onUp for a plain drawing move calls updateDrawing and onDrawingMoved with before/after points", () => {
    const opts = makeOpts({ onDrawingMoved: vi.fn() });
    const { result } = renderHook(() => useChartInteractions(opts));
    const original = [{ t: 0, price: 100 }, { t: 1000, price: 110 }];
    act(() => {
      result.current.drawingDragRef.current = { drawingId: "d1", dx: 500, dy: 2, originalPoints: original };
    });
    act(() => {
      result.current.onUp();
    });
    expect(opts.updateDrawing).toHaveBeenCalledWith("d1", [
      { t: 500, price: 98 },
      { t: 1500, price: 108 },
    ]);
    expect(opts.onDrawingMoved).toHaveBeenCalledWith("d1", original);
  });

  it("onUp for a corner resize uses rs.originalPoints as the 'before' geometry", () => {
    const opts = makeOpts({ onDrawingMoved: vi.fn() });
    const { result } = renderHook(() => useChartInteractions(opts));
    const resizedPoints = [{ t: 100, price: 90 }, { t: 900, price: 60 }];
    const origPoints = [{ t: 0, price: 100 }, { t: 1000, price: 50 }];
    act(() => {
      result.current.drawingDragRef.current = { drawingId: "d1", dx: 0, dy: 0, originalPoints: resizedPoints };
      result.current.drawingResizeRef.current = {
        drawingId: "d1", handleIdx: 0, origMinT: 0, origMaxT: 1000, origMinPrice: 50, origMaxPrice: 100,
        originalPoints: origPoints,
      };
    });
    act(() => {
      result.current.onUp();
    });
    expect(opts.updateDrawing).toHaveBeenCalledWith("d1", resizedPoints);
    expect(opts.onDrawingMoved).toHaveBeenCalledWith("d1", origPoints);
  });

  it("onUp does nothing when there is no drag in progress", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.onUp();
    });
    expect(opts.updateDrawing).not.toHaveBeenCalled();
  });
});

describe("useChartInteractions — onDouble and onLeave", () => {
  it("onDouble resets the view and redraws", () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.viewRef.current = { t0: 0, t1: 100, y0: 0, y1: 1 };
    });
    act(() => {
      result.current.onDouble();
    });
    expect(result.current.viewRef.current).toBeNull();
    expect(opts.redraw).toHaveBeenCalled();
  });

  it("onLeave clears hover/drag/resize state and redraws", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.dragRef.current = { mx: 0, my: 0, mode: "pan", view: { t0: 0, t1: 1, y0: 0, y1: 1 } };
    });
    act(() => {
      result.current.onLeave();
    });
    expect(result.current.dragRef.current).toBeNull();
    await vi.waitFor(() => expect(opts.redraw).toHaveBeenCalled());
  });
});

describe("useChartInteractions — keyboard delete", () => {
  it("Delete key calls onDeleteSelected when a drawing is selected and not locked", () => {
    const onDeleteSelected = vi.fn();
    const opts = makeOpts({ selectedDrawingId: "d1", onDeleteSelected, locked: false });
    renderHook(() => useChartInteractions(opts));
    const evt = new KeyboardEvent("keydown", { key: "Delete", cancelable: true });
    window.dispatchEvent(evt);
    expect(onDeleteSelected).toHaveBeenCalled();
  });

  it("Delete key does nothing when locked", () => {
    const onDeleteSelected = vi.fn();
    const opts = makeOpts({ selectedDrawingId: "d1", onDeleteSelected, locked: true });
    renderHook(() => useChartInteractions(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
    expect(onDeleteSelected).not.toHaveBeenCalled();
  });

  it("Delete key does nothing when nothing is selected", () => {
    const onDeleteSelected = vi.fn();
    const opts = makeOpts({ selectedDrawingId: null, onDeleteSelected });
    renderHook(() => useChartInteractions(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
    expect(onDeleteSelected).not.toHaveBeenCalled();
  });

  it("Delete key is ignored while focus is inside an input", () => {
    const onDeleteSelected = vi.fn();
    const opts = makeOpts({ selectedDrawingId: "d1", onDeleteSelected });
    renderHook(() => useChartInteractions(opts));
    const input = document.createElement("input");
    document.body.appendChild(input);
    const evt = new KeyboardEvent("keydown", { key: "Delete" });
    Object.defineProperty(evt, "target", { value: input });
    window.dispatchEvent(evt);
    expect(onDeleteSelected).not.toHaveBeenCalled();
  });

  it("Backspace also triggers delete, other keys do not", () => {
    const onDeleteSelected = vi.fn();
    const opts = makeOpts({ selectedDrawingId: "d1", onDeleteSelected });
    renderHook(() => useChartInteractions(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(onDeleteSelected).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
    expect(onDeleteSelected).toHaveBeenCalled();
  });
});

describe("useChartInteractions — wheel zoom", () => {
  it("zooming via wheel updates the view and triggers a redraw", async () => {
    const opts = makeOpts();
    const { result } = renderHook(() => useChartInteractions(opts));
    act(() => {
      result.current.layoutRef.current = { plotX: 80, plotW: 600, plotH: 300 };
      result.current.viewRef.current = { t0: 0, t1: 100000, y0: 0, y1: 100 };
    });
    const canvas = opts.canvasRef.current!;
    const wheelEvt = new WheelEvent("wheel", { deltaY: 100, clientX: 400, clientY: 150, cancelable: true });
    act(() => {
      canvas.dispatchEvent(wheelEvt);
    });
    expect(result.current.viewRef.current).not.toEqual({ t0: 0, t1: 100000, y0: 0, y1: 100 });
    await vi.waitFor(() => expect(opts.redraw).toHaveBeenCalled());
  });

  it("wheel handler no-ops when there is no view/layout yet", () => {
    const opts = makeOpts();
    renderHook(() => useChartInteractions(opts));
    const canvas = opts.canvasRef.current!;
    expect(() =>
      canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true })),
    ).not.toThrow();
    expect(opts.redraw).not.toHaveBeenCalled();
  });
});
