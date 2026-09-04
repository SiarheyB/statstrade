import { describe, it, expect } from "vitest";
import { generateSyntheticOrderBook } from "@/engine/market/orderBook";
import { mulberry32 } from "@/engine/rng";

describe("generateSyntheticOrderBook", () => {
  it("возвращает запрошенное число уровней с обеих сторон", () => {
    const book = generateSyntheticOrderBook(100, 0.01, 10, mulberry32(1));
    expect(book.bids).toHaveLength(10);
    expect(book.asks).toHaveLength(10);
  });

  it("бид строго ниже mid, аск строго выше mid", () => {
    const book = generateSyntheticOrderBook(100, 0.01, 5, mulberry32(2));
    for (const b of book.bids) expect(b.price).toBeLessThan(100);
    for (const a of book.asks) expect(a.price).toBeGreaterThan(100);
  });

  it("объём убывает по мере удаления от mid (в среднем — первый уровень толще последнего)", () => {
    const book = generateSyntheticOrderBook(100, 0.01, 10, mulberry32(3));
    expect(book.bids[0].size).toBeGreaterThan(book.bids[9].size);
    expect(book.asks[0].size).toBeGreaterThan(book.asks[9].size);
  });

  it("все размеры положительны и конечны", () => {
    const book = generateSyntheticOrderBook(100, 0.01, 10, mulberry32(4));
    for (const level of [...book.bids, ...book.asks]) {
      expect(level.size).toBeGreaterThan(0);
      expect(Number.isFinite(level.size)).toBe(true);
    }
  });

  it("детерминирован для одного и того же сида", () => {
    const a = generateSyntheticOrderBook(100, 0.01, 10, mulberry32(42));
    const b = generateSyntheticOrderBook(100, 0.01, 10, mulberry32(42));
    expect(a).toEqual(b);
  });
});
