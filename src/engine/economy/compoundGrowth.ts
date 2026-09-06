// Сложный процент — раздел 4.8 спеки. Чисто информационный прогноз для UI
// investing-режима ("если ничего не менять, через N лет будет X"), не
// влияет на реальную симуляцию.
//
// futureValue = principal * (1 + annualReturn/n)^(n*years)
export function calculateFutureValue(principal: number, annualReturn: number, years: number, n: number = 4): number {
  return principal * (1 + annualReturn / n) ** (n * years);
}
