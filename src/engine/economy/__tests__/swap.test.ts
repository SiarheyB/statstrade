import { describe, it, expect } from "vitest";
import { swapFee, totalSwapFee, SWAP_ANNUAL_RATE } from "@/engine/economy/swap";
import type { Position } from "@/engine/entities/types";

const DAY = 24 * 60 * 60 * 1000;

const position = (patch: Partial<Position> = {}): Position => ({
  id: "p1",
  assetId: "A",
  side: "long",
  entryPrice: 100,
  size: 10,
  leverage: 1,
  openedAt: 0,
  fees: 0,
  style: "day",
  ...patch,
});

describe("плата за перенос плеча", () => {
  it("без плеча платы нет — свои деньги процентов не стоят", () => {
    expect(swapFee(position({ leverage: 1 }), 30 * DAY)).toBe(0);
  });

  it("берётся только с заёмной части", () => {
    // Номинал 100 × 10 × 10 = 10 000, своих 1 000, заёмных 9 000.
    const year = 365 * DAY;
    expect(swapFee(position({ leverage: 10 }), year)).toBeCloseTo(9_000 * SWAP_ANNUAL_RATE, 6);
  });

  it("считается непрерывно: за час платится за час, а не за сутки", () => {
    const hour = 60 * 60 * 1000;
    const day = swapFee(position({ leverage: 5 }), DAY);
    const perHour = swapFee(position({ leverage: 5 }), hour);
    expect(perHour * 24).toBeCloseTo(day, 9);
  });

  it("чем больше плечо, тем дороже держать", () => {
    expect(swapFee(position({ leverage: 10 }), DAY)).toBeGreaterThan(swapFee(position({ leverage: 2 }), DAY));
  });

  it("суммируется по открытым позициям и не считает закрытые", () => {
    const positions = [
      position({ id: "a", leverage: 5 }),
      position({ id: "b", leverage: 5 }),
      position({ id: "c", leverage: 5, closedAt: 1 }),
    ];
    expect(totalSwapFee(positions, DAY)).toBeCloseTo(swapFee(position({ leverage: 5 }), DAY) * 2, 9);
  });

  it("суточная плата по десятому плечу заметна, но не разорительна", () => {
    // Ориентир: на номинале 10 000 это порядка двух долларов в сутки —
    // достаточно, чтобы держать плечо месяцами было невыгодно, и мало,
    // чтобы это мешало торговать внутри дня.
    const perDay = swapFee(position({ leverage: 10 }), DAY);
    expect(perDay).toBeGreaterThan(1);
    expect(perDay).toBeLessThan(5);
  });
});
