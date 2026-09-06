import { describe, it, expect } from "vitest";
import {
  calculateFees,
  calculateRealizedPnl,
  calculateUnrealizedPnl,
  levelAmount,
  percentAmount,
  settleClose,
} from "@/engine/economy/pnlCalculator";
import type { Position } from "@/engine/entities/types";

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "p1",
    assetId: "STK_TEST",
    side: "long",
    entryPrice: 100,
    size: 10,
    leverage: 1,
    openedAt: Date.now(),
    fees: 0,
    style: "day",
    ...overrides,
  };
}

describe("calculateFees", () => {
  it("считает комиссию с обеих сторон сделки плюс спред-косты (раздел 4.1)", () => {
    // (100*10 + 110*10) * 0.0008 + 5 = 2100*0.0008 + 5 = 1.68 + 5 = 6.68
    expect(calculateFees(100, 110, 10, 0.0008, 5)).toBeCloseTo(6.68, 5);
  });
});

describe("calculateRealizedPnl", () => {
  it("long: (close - entry) * size * leverage - fees", () => {
    const pos = makePosition({ entryPrice: 100, size: 10, leverage: 1, fees: 2 });
    // (110-100)*10*1 - 2 = 98
    expect(calculateRealizedPnl(pos, 110)).toBeCloseTo(98, 5);
  });

  it("short: (entry - close) * size * leverage - fees", () => {
    const pos = makePosition({ side: "short", entryPrice: 100, size: 10, leverage: 1, fees: 2 });
    // (100-110)*10*1 - 2 = -102 (цена выросла — шорт в убытке)
    expect(calculateRealizedPnl(pos, 110)).toBeCloseTo(-102, 5);
  });

  it("плечо масштабирует PnL пропорционально (готовность к Фазе 2)", () => {
    const pos = makePosition({ entryPrice: 100, size: 10, leverage: 5, fees: 0 });
    expect(calculateRealizedPnl(pos, 110)).toBeCloseTo((110 - 100) * 10 * 5, 5);
  });
});

describe("calculateUnrealizedPnl", () => {
  it("совпадает с realized-расчётом на той же цене (симметрия формул)", () => {
    const pos = makePosition({ entryPrice: 100, size: 10, leverage: 2, fees: 3 });
    expect(calculateUnrealizedPnl(pos, 120)).toBe(calculateRealizedPnl(pos, 120));
  });
});

describe("settleClose", () => {
  it("сам считает fees по entry+exit (position.fees при открытии всегда 0 — формула 4.1 знает closePrice только в момент закрытия)", () => {
    const pos = makePosition({ entryPrice: 100, size: 10, fees: 0 });
    const { fees, realizedPnl } = settleClose(pos, 110, 0.0008, 0);
    expect(fees).toBeCloseTo((100 * 10 + 110 * 10) * 0.0008, 5);
    expect(realizedPnl).toBeCloseTo((110 - 100) * 10 - fees, 5);
  });

  it("игнорирует любое ранее выставленное position.fees — не складывает старое со свежерасчитанным", () => {
    const pos = makePosition({ entryPrice: 100, size: 10, fees: 999 });
    const { realizedPnl } = settleClose(pos, 100, 0, 0);
    expect(realizedPnl).toBe(0); // без движения цены и без комиссии — PnL ровно 0
  });
});


describe("уровни в деньгах", () => {
  it("считает расстояние до уровня объёмом и плечом", () => {
    // Стоп в 5 долларах от цены на объёме 2 с плечом 3 — это 30 долларов.
    expect(levelAmount(100, 95, 2, 3)).toBe(30);
    // Направление не важно: тейк выше цены стоит столько же, сколько стоп ниже.
    expect(levelAmount(100, 105, 2, 3)).toBe(30);
  });

  it("без цены, объёма или уровня денег не обещает", () => {
    expect(levelAmount(0, 95, 2, 1)).toBe(0);
    expect(levelAmount(100, 0, 2, 1)).toBe(0);
    expect(levelAmount(100, 95, 0, 1)).toBe(0);
  });

  it("процент переводит в деньги через цену", () => {
    // 2% от цены 100 на объёме 5 без плеча — 10 долларов.
    expect(percentAmount(100, 2, 5, 1)).toBeCloseTo(10);
    expect(percentAmount(100, 2, 5, 2)).toBeCloseTo(20);
  });

  it("нулевой процент — не сделка", () => {
    expect(percentAmount(100, 0, 5, 1)).toBe(0);
  });

  it("совпадает с реальным результатом сделки", () => {
    // Главная проверка: обещанная в тикете сумма должна сойтись с тем, что
    // человек увидит в журнале, — иначе цифра под полем вводит в заблуждение.
    const position = makePosition({ side: "long", size: 2, entryPrice: 100, leverage: 3, fees: 0 });
    const promised = levelAmount(100, 95, 2, 3);
    expect(Math.abs(calculateRealizedPnl(position, 95))).toBe(promised);
  });
});
