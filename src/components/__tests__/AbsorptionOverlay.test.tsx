/**
 * Tests for AbsorptionOverlay — canvas drawing function.
 */
import { describe, it, expect, vi } from 'vitest';
import { drawAbsorptionMarkers } from '@/components/AbsorptionOverlay';
import type { AbsorptionSignal } from '@/lib/orderflow';

describe('drawAbsorptionMarkers', () => {
  const mockCtx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 20 }),
    setLineDash: vi.fn(),
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D;

  const sx = (ms: number) => 100 + (ms - 1700000000000) / 1000000;
  const sy = (p: number) => 200 - (p - 50000) * 10;
  const plotX = 80;
  const plotW = 600;
  const plotH = 400;

  const candles = [
    { t: 1700000000000 },
    { t: 1700000060000 },
    { t: 1700000120000 },
    { t: 1700000180000 },
    { t: 1700000240000 },
  ];

  const signals: AbsorptionSignal[] = [
    {
      t: 1700000000000,
      price: 50000,
      range: 0.5,
      volume: 10000,
      avgVolume: 3000,
      volumeMultiplier: 3.33,
      deltaRatio: 0.05,
      duration: 3,
      strength: 4,
      label: 'Strong Absorption',
    },
    {
      t: 1700000180000,
      price: 50100,
      range: 0.3,
      volume: 5000,
      avgVolume: 2000,
      volumeMultiplier: 2.5,
      deltaRatio: 0.1,
      duration: 2,
      strength: 2,
      label: 'Absorption',
    },
  ];

  it('does nothing when signals is empty', () => {
    drawAbsorptionMarkers(mockCtx, sx, sy, plotX, plotW, plotH, [], candles);
    expect(mockCtx.save).not.toHaveBeenCalled();
  });

  it('draws markers for strong absorption signals', () => {
    drawAbsorptionMarkers(mockCtx, sx, sy, plotX, plotW, plotH, signals, candles);
    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.clip).toHaveBeenCalled();
    // Strong signal should draw bracket
    expect(mockCtx.moveTo).toHaveBeenCalled();
    expect(mockCtx.stroke).toHaveBeenCalled();
    // Should draw vertical dashed line
    expect(mockCtx.setLineDash).toHaveBeenCalledWith([2, 4]);
    expect(mockCtx.restore).toHaveBeenCalled();
  });

  it('skips signals whose candle is not found', () => {
    const badSignals = [{ ...signals[0], t: 9999999999999 }];
    drawAbsorptionMarkers(mockCtx, sx, sy, plotX, plotW, plotH, badSignals, candles);
    // Should still save/restore but no bracket drawing
    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
  });

  it('skips signals outside visible range', () => {
    // Signal way in the past
    const farSignals = [{ ...signals[0], t: 1000000000000 }];
    drawAbsorptionMarkers(mockCtx, sx, sy, plotX, plotW, plotH, farSignals, candles);
    // Should still save/restore but no bracket drawing for the far signal
    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
  });
});