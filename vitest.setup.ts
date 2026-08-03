import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount React trees after every test to avoid leaking DOM between them.
afterEach(() => {
  cleanup();
});

// jsdom не реализует canvas — HTMLCanvasElement.getContext("2d") возвращает
// null по умолчанию, из-за чего весь код рисования (orderflow/forex/liqmap,
// candlestickChart.ts) молча пропускается через `if (!ctx) return`. Даём
// заглушку 2D-контекста (все методы — no-op, но реально вызываются), чтобы
// эти ветки выполнялись в тестах и попадали в покрытие.
function makeFakeCtx() {
  const ctx: Record<string, unknown> = {
    canvas: undefined,
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "left",
    textBaseline: "alphabetic", globalAlpha: 1, imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(), rect: vi.fn(),
    roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), clip: vi.fn(),
    fillRect: vi.fn(), strokeRect: vi.fn(), clearRect: vi.fn(),
    fillText: vi.fn(), strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    setLineDash: vi.fn(), getLineDash: vi.fn(() => []),
    setTransform: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
    drawImage: vi.fn(),
    createImageData: vi.fn((w: number, h: number) => ({
      width: w, height: h, data: new Uint8ClampedArray(w * h * 4),
    })),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
      width: w, height: h, data: new Uint8ClampedArray(w * h * 4),
    })),
    putImageData: vi.fn(),
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
    return makeFakeCtx();
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
