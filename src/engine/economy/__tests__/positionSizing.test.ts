import { describe, it, expect } from "vitest";
import { suggestPositionSize } from "@/engine/economy/positionSizing";

describe("suggestPositionSize", () => {
  it("= (accountBalance * riskPerTradePct) / (entryPrice - stopLossPrice)", () => {
    // (10000 * 0.01) / (100 - 95) = 100 / 5 = 20
    expect(suggestPositionSize(10000, 0.01, 100, 95)).toBeCloseTo(20, 5);
  });

  it("работает одинаково для стопа выше входа (шорт) — берёт модуль разницы", () => {
    expect(suggestPositionSize(10000, 0.01, 100, 105)).toBeCloseTo(20, 5);
  });

  it("возвращает null, если стоп совпадает с ценой входа (риск на единицу = 0)", () => {
    expect(suggestPositionSize(10000, 0.01, 100, 100)).toBeNull();
  });

  it("больше риск на сделку — больше рекомендуемый размер", () => {
    const small = suggestPositionSize(10000, 0.005, 100, 95)!;
    const large = suggestPositionSize(10000, 0.02, 100, 95)!;
    expect(large).toBeGreaterThan(small);
  });
});
