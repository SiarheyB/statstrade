import { describe, it, expect } from "vitest";
import { calculateFutureValue } from "@/engine/economy/compoundGrowth";

describe("calculateFutureValue", () => {
  it("= principal * (1 + annualReturn/n)^(n*years)", () => {
    // 10000 * (1 + 0.08/4)^(4*10) — стандартный пример квартальной капитализации
    const expected = 10000 * (1 + 0.08 / 4) ** (4 * 10);
    expect(calculateFutureValue(10000, 0.08, 10, 4)).toBeCloseTo(expected, 5);
  });

  it("больше срок — больше итоговая сумма (при положительной доходности)", () => {
    const v5 = calculateFutureValue(10000, 0.07, 5);
    const v20 = calculateFutureValue(10000, 0.07, 20);
    expect(v20).toBeGreaterThan(v5);
  });

  it("нулевая доходность не меняет principal", () => {
    expect(calculateFutureValue(10000, 0, 10)).toBeCloseTo(10000, 5);
  });

  it("нулевой срок возвращает principal", () => {
    expect(calculateFutureValue(10000, 0.08, 0)).toBeCloseTo(10000, 5);
  });
});
