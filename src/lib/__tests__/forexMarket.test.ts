import { describe, it, expect } from "vitest";
import { isForexMarketClosed } from "@/lib/forexMarket";

const at = (iso: string) => Date.parse(iso);

describe("isForexMarketClosed", () => {
  it("будни — рынок открыт", () => {
    expect(isForexMarketClosed(at("2026-08-17T09:00:00Z"))).toBe(false); // понедельник
    expect(isForexMarketClosed(at("2026-08-19T23:30:00Z"))).toBe(false); // среда, ночь
    expect(isForexMarketClosed(at("2026-08-21T20:59:00Z"))).toBe(false); // пятница до закрытия
  });

  it("с вечера пятницы — закрыт", () => {
    expect(isForexMarketClosed(at("2026-08-21T21:00:00Z"))).toBe(true);
    expect(isForexMarketClosed(at("2026-08-21T23:59:00Z"))).toBe(true);
  });

  it("суббота — закрыт целиком", () => {
    expect(isForexMarketClosed(at("2026-08-22T00:00:00Z"))).toBe(true);
    expect(isForexMarketClosed(at("2026-08-22T12:00:00Z"))).toBe(true);
    expect(isForexMarketClosed(at("2026-08-22T23:59:00Z"))).toBe(true);
  });

  it("воскресенье — закрыт до вечера", () => {
    expect(isForexMarketClosed(at("2026-08-23T12:00:00Z"))).toBe(true);
    expect(isForexMarketClosed(at("2026-08-23T21:59:00Z"))).toBe(true);
    expect(isForexMarketClosed(at("2026-08-23T22:00:00Z"))).toBe(false);
  });
});
