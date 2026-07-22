/**
 * Тесты для drawDivergenceMarkers — рисование маркеров дивергенции на canvas.
 * src/components/DivergenceOverlay.tsx
 */

import { describe, it, expect, vi } from "vitest";
import { drawDivergenceMarkers } from "@/components/DivergenceOverlay";
import type { DivergenceSignal } from "@/lib/orderflow";

// Создаём мок canvas контекста.
function mockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fillText: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    // Настройки, которые меняет функция.
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
  } as unknown as CanvasRenderingContext2D;
}

function sx(ms: number): number {
  return 100 + ((ms - 1000) / 1000) * 500;
}
function sy(p: number): number {
  return 300 - ((p - 90) / 60) * 300;
}

function makeSignal(overrides: Partial<DivergenceSignal>): DivergenceSignal {
  return {
    id: "test-1",
    type: "regular_bearish",
    strength: 3,
    t: 1500,
    pricePeak: 120,
    priceTrough: 110,
    deltaPeak: 100,
    deltaTrough: -50,
    bars: 5,
    confirmed: false,
    label: "Regular Bearish",
    ...overrides,
  };
}

describe("drawDivergenceMarkers", () => {
  it("does nothing when signals is empty", () => {
    const ctx = mockCtx();
    drawDivergenceMarkers(ctx, sx, sy, 100, 500, 300, []);
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it("draws a regular bearish marker (down arrow)", () => {
    const ctx = mockCtx();
    const sig = makeSignal({ type: "regular_bearish", t: 1500, pricePeak: 120 });
    drawDivergenceMarkers(ctx, sx, sy, 100, 500, 300, [sig]);

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    // Проверяем, что fill был вызван (стрелка нарисована).
    expect(ctx.fill).toHaveBeenCalled();
    // Проверяем, что текст был написан.
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("R-Bear"), expect.any(Number), expect.any(Number));
  });

  it("draws a regular bullish marker (up arrow)", () => {
    const ctx = mockCtx();
    const sig = makeSignal({ type: "regular_bullish", t: 1500, priceTrough: 100 });
    drawDivergenceMarkers(ctx, sx, sy, 100, 500, 300, [sig]);

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("R-Bull"), expect.any(Number), expect.any(Number));
  });

  it("draws hidden markers smaller (dimmed alpha)", () => {
    const ctx = mockCtx();
    const sig = makeSignal({ type: "hidden_bullish", t: 1500, priceTrough: 100 });
    drawDivergenceMarkers(ctx, sx, sy, 100, 500, 300, [sig]);

    // Для hidden-сигнала alpha должна быть 0.55
    expect(ctx.globalAlpha).toBe(0.55);
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("H-Bull"), expect.any(Number), expect.any(Number));
  });

  it("draws confirmed markers with stroke", () => {
    const ctx = mockCtx();
    const sig = makeSignal({ type: "regular_bearish", t: 1500, pricePeak: 120, confirmed: true });
    drawDivergenceMarkers(ctx, sx, sy, 100, 500, 300, [sig]);

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    // Для confirmed должен быть вызов stroke.
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("skips signals outside visible area", () => {
    const ctx = mockCtx();
    // Сигнал с временем, которое даёт x вне [100, 600].
    const sig = makeSignal({ t: 0, pricePeak: 120 });
    drawDivergenceMarkers(ctx, sx, sy, 100, 500, 300, [sig]);

    // sx(0) = 100 + ((0 - 1000) / 1000) * 500 = 100 - 500 = -400 — вне области.
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it("handles multiple signals", () => {
    const ctx = mockCtx();
    const sigs = [
      makeSignal({ id: "s1", type: "regular_bearish", t: 1500, pricePeak: 120 }),
      makeSignal({ id: "s2", type: "regular_bullish", t: 2000, priceTrough: 100 }),
    ];
    drawDivergenceMarkers(ctx, sx, sy, 100, 500, 300, sigs);

    expect(ctx.fill).toHaveBeenCalledTimes(2);
    // R-Bear и R-Bull.
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("R-Bear"), expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("R-Bull"), expect.any(Number), expect.any(Number));
  });

  it("draws hidden bearish marker", () => {
    const ctx = mockCtx();
    const sig = makeSignal({ type: "hidden_bearish", t: 1500, pricePeak: 120 });
    drawDivergenceMarkers(ctx, sx, sy, 100, 500, 300, [sig]);

    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("H-Bear"), expect.any(Number), expect.any(Number));
  });
});