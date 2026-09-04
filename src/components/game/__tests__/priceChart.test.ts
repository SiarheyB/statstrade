import { describe, it, expect } from "vitest";
import { aggregateCandles } from "@/components/game/PriceChart";
import { fmtGameClock, fmtGameDuration } from "@/lib/gameTime";

type C = { t: number; o: number; h: number; l: number; c: number };

const MIN = 60_000;

function series(): C[] {
  // 6 минутных свечей подряд
  return [
    { t: 0 * MIN, o: 10, h: 12, l: 9, c: 11 },
    { t: 1 * MIN, o: 11, h: 15, l: 10, c: 14 },
    { t: 2 * MIN, o: 14, h: 14, l: 8, c: 9 },
    { t: 3 * MIN, o: 9, h: 11, l: 7, c: 10 },
    { t: 4 * MIN, o: 10, h: 13, l: 10, c: 12 },
    { t: 5 * MIN, o: 12, h: 12, l: 11, c: 11 },
  ];
}

describe("aggregateCandles", () => {
  it("на множителе 1 отдаёт исходный ряд", () => {
    const input = series();
    expect(aggregateCandles(input, MIN, 1)).toBe(input);
  });

  it("склеивает свечи по OHLC-правилам: open первой, close последней, максимум и минимум по всем", () => {
    const [first] = aggregateCandles(series(), MIN, 3);
    expect(first).toEqual({ t: 0, o: 10, h: 15, l: 8, c: 9 });
  });

  it("делит ряд на бакеты по времени, а не по счётчику: 6 минуток при x3 дают 2 свечи", () => {
    const out = aggregateCandles(series(), MIN, 3);
    expect(out).toHaveLength(2);
    expect(out[1].t).toBe(3 * MIN);
    expect(out[1].c).toBe(11);
  });

  it("неполный последний бакет не выбрасывается — это текущая, ещё формирующаяся свеча", () => {
    const out = aggregateCandles(series().slice(0, 4), MIN, 3);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ t: 3 * MIN, o: 9, h: 11, l: 7, c: 10 });
  });

  it("пропуск в истории не склеивает соседние бакеты в один", () => {
    const gapped: C[] = [
      { t: 0, o: 1, h: 1, l: 1, c: 1 },
      { t: 10 * MIN, o: 2, h: 2, l: 2, c: 2 },
    ];
    const out = aggregateCandles(gapped, MIN, 3);
    expect(out.map((k) => k.t)).toEqual([0, 9 * MIN]);
  });

  it("пустой ряд не ломает агрегацию", () => {
    expect(aggregateCandles([], MIN, 5)).toEqual([]);
  });
});

describe("подписи игрового времени", () => {
  it("длительность свечи подписывается в минутах, часах или днях", () => {
    expect(fmtGameDuration(MIN)).toBe("1м");
    expect(fmtGameDuration(15 * MIN)).toBe("15м");
    expect(fmtGameDuration(60 * MIN)).toBe("1ч");
    expect(fmtGameDuration(12 * 60 * MIN)).toBe("12ч");
    expect(fmtGameDuration(60 * 60 * MIN)).toBe("2.5д");
  });

  it("часы игрового времени показываются как день + время", () => {
    expect(fmtGameClock(0)).toBe("Д1 00:00");
    expect(fmtGameClock(25 * 60 * MIN)).toBe("Д2 01:00");
  });
});
