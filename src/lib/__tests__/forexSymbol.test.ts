import { describe, it, expect } from "vitest";
import { normalizeFxSymbol, DEFAULT_FX_SYMBOL } from "@/lib/forexSymbol";

// Символ уходил и в запрос к БД, и в КЛЮЧ кэша ответов (`symbol|range|tz`).
// Число записей в routeCache ограничено, а длина ключа — нет.
describe("normalizeFxSymbol", () => {
  it("пропускает валидные пары и приводит к верхнему регистру", () => {
    expect(normalizeFxSymbol("EUR/USD")).toBe("EUR/USD");
    expect(normalizeFxSymbol("gbp/jpy")).toBe("GBP/JPY");
    expect(normalizeFxSymbol("XAU/USD")).toBe("XAU/USD");
  });

  it("отсутствие параметра — это дефолтная пара, а не отказ", () => {
    expect(normalizeFxSymbol(null)).toBe(DEFAULT_FX_SYMBOL);
    expect(normalizeFxSymbol(undefined)).toBe(DEFAULT_FX_SYMBOL);
  });

  it("режет строку любой длины", () => {
    expect(normalizeFxSymbol("A".repeat(100000))).toBeNull();
    expect(normalizeFxSymbol(`${"A".repeat(20)}/USD`)).toBeNull();
  });

  it("отвергает мусор и посторонние символы", () => {
    for (const bad of ["", "EURUSD", "EUR/USD/JPY", "EUR/US D", "../../etc", "EUR/USD;DROP", "%00"]) {
      expect(normalizeFxSymbol(bad)).toBeNull();
    }
  });
});
