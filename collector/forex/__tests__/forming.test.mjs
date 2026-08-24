import { describe, it, expect } from "vitest";
import { ticksToCandle } from "../forming.mjs";

// Данные — настоящий срез с freeserv (EUR/USD, закрытая минута 14:25 UTC):
// бар Dukascopy за неё o=1.1669 h=1.16696 l=1.16686 c=1.16687 v=158.88.
// Здесь тот же расклад в миниатюре: важно, что O/H/L/C берутся по времени,
// а объём делится на 1e6.
const MIN = 1_700_000_040_000; // ровная минута
const tick = (offsetMs, bid, bidVol) => ({ t: MIN + offsetMs, bid, ask: bid + 0.00002, bidVol, askVol: 0 });

describe("collector/forex/forming", () => {
  it("собирает OHLCV минутки из тиков окна", () => {
    const ticks = [
      tick(500, 1.1669, 40_000_000),
      tick(20_000, 1.16696, 30_000_000),
      tick(45_000, 1.16686, 50_000_000),
      tick(59_000, 1.16687, 38_880_000),
    ];
    expect(ticksToCandle(ticks, MIN, MIN + 60_000)).toEqual({
      o: 1.1669, h: 1.16696, l: 1.16686, c: 1.16687, v: 158.88, n: 4,
    });
  });

  it("берёт открытие/закрытие по времени, а не по порядку в массиве", () => {
    const ticks = [tick(30_000, 2, 0), tick(1_000, 1, 0), tick(50_000, 3, 0)];
    const c = ticksToCandle(ticks, MIN, MIN + 60_000);
    expect(c.o).toBe(1);
    expect(c.c).toBe(3);
  });

  it("отбрасывает тики соседних минут", () => {
    const ticks = [tick(-5_000, 9, 0), tick(10_000, 1.5, 0), tick(61_000, 9, 0)];
    const c = ticksToCandle(ticks, MIN, MIN + 60_000);
    expect(c).toEqual({ o: 1.5, h: 1.5, l: 1.5, c: 1.5, v: 0, n: 1 });
  });

  it("возвращает null, когда в окно не попал ни один тик", () => {
    expect(ticksToCandle([tick(-1, 1, 0)], MIN, MIN + 60_000)).toBeNull();
    expect(ticksToCandle([], MIN, MIN + 60_000)).toBeNull();
  });

  it("не спотыкается о мусор в ответе", () => {
    const ticks = [null, { t: "nope", bid: 1 }, { t: MIN + 1, bid: null }, tick(2_000, 1.2, 1_000_000)];
    expect(ticksToCandle(ticks, MIN, MIN + 60_000)).toEqual({
      o: 1.2, h: 1.2, l: 1.2, c: 1.2, v: 1, n: 1,
    });
  });
});
