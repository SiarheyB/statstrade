import { describe, it, expect } from "vitest";
import { isMarketOpen, nextOpen, sessionOf } from "@/lib/game/schedule";
import { gapOpen, MAX_GAP } from "@/lib/game/marketGen";
import type { Asset } from "@/engine/entities/types";

const utc = (iso: string) => new Date(`${iso}Z`).getTime();

describe("расписание торгов", () => {
  it("крипта не закрывается никогда — в этом её отличие от остальных рынков", () => {
    expect(sessionOf("crypto")).toBe("always");
    for (const ts of ["2026-09-05T03:00", "2026-09-06T12:00", "2026-09-07T21:30"]) {
      expect(isMarketOpen("crypto", utc(ts))).toBe(true);
    }
  });

  it("форекс стоит с пятничного вечера до вечера воскресенья", () => {
    expect(isMarketOpen("forex", utc("2026-09-04T20:59"))).toBe(true); // пятница до закрытия
    expect(isMarketOpen("forex", utc("2026-09-04T21:00"))).toBe(false); // пятница, закрылись
    expect(isMarketOpen("forex", utc("2026-09-05T12:00"))).toBe(false); // суббота целиком
    expect(isMarketOpen("forex", utc("2026-09-06T21:59"))).toBe(false); // воскресенье до открытия
    expect(isMarketOpen("forex", utc("2026-09-06T22:00"))).toBe(true); // воскресенье, открылись
    expect(isMarketOpen("forex", utc("2026-09-07T04:00"))).toBe(true); // азиатская сессия понедельника
  });

  it("металлы и нефть живут по форексному расписанию, а не биржевому", () => {
    expect(sessionOf("commodity")).toBe("forex");
    expect(isMarketOpen("commodity", utc("2026-09-07T04:00"))).toBe(true);
    expect(isMarketOpen("commodity", utc("2026-09-05T12:00"))).toBe(false);
  });

  it("акции торгуются только в дневную сессию будней", () => {
    expect(isMarketOpen("stock", utc("2026-09-07T13:59"))).toBe(false);
    expect(isMarketOpen("stock", utc("2026-09-07T14:00"))).toBe(true);
    expect(isMarketOpen("stock", utc("2026-09-07T20:59"))).toBe(true);
    expect(isMarketOpen("stock", utc("2026-09-07T21:00"))).toBe(false);
    expect(isMarketOpen("stock", utc("2026-09-05T16:00"))).toBe(false); // суббота
  });

  it("nextOpen возвращает сам момент, если рынок уже открыт", () => {
    const ts = utc("2026-09-07T15:00");
    expect(nextOpen("stock", ts)).toBe(ts);
  });

  it("после пятничного закрытия ближайшее открытие форекса — вечер воскресенья", () => {
    expect(nextOpen("forex", utc("2026-09-04T22:15"))).toBe(utc("2026-09-06T22:00"));
  });

  it("ночью ближайшее открытие акций — сегодняшние 14:00", () => {
    expect(nextOpen("stock", utc("2026-09-08T06:00"))).toBe(utc("2026-09-08T14:00"));
  });
});

describe("гэп на открытии", () => {
  const asset = (volatility: number): Asset =>
    ({
      id: "T",
      symbol: "T",
      name: "T",
      assetClass: "stock",
      sector: "tech",
      correlationGroup: "tech",
      baseVolatility: volatility,
      baseDrift: 0.05,
      tickSize: 0.01,
      startPrice: 100,
    }) as unknown as Asset;

  it("без перерыва разрыва нет", () => {
    expect(gapOpen(100, { seed: "s", asset: asset(0.35), index: 5, closedMs: 0, volModifier: 1 })).toBe(100);
  });

  it("выходные по акции дают разрыв в разумных единицах процента", () => {
    const weekend = 62 * 3_600_000;
    const gaps: number[] = [];
    for (let i = 0; i < 400; i++) {
      const open = gapOpen(100, { seed: "s", asset: asset(0.35), index: i, closedMs: weekend, volModifier: 1 });
      gaps.push(Math.abs(open - 100));
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    // Разрыв должен быть заметен на графике, но не превращать понедельник в
    // обвал: сотые доли процента незаметны, десять процентов — катастрофа.
    expect(mean).toBeGreaterThan(0.1);
    expect(mean).toBeLessThan(3);
  });

  it("спокойный инструмент рвётся слабее буйного", () => {
    const weekend = 62 * 3_600_000;
    const avg = (vol: number) => {
      let sum = 0;
      for (let i = 0; i < 300; i++) {
        sum += Math.abs(gapOpen(100, { seed: "s", asset: asset(vol), index: i, closedMs: weekend, volModifier: 1 }) - 100);
      }
      return sum / 300;
    };
    expect(avg(0.08)).toBeLessThan(avg(0.5));
  });

  it("длинный перерыв не пробивает потолок разрыва", () => {
    const year = 365 * 24 * 3_600_000;
    for (let i = 0; i < 200; i++) {
      const open = gapOpen(100, { seed: "s", asset: asset(1.2), index: i, closedMs: year, volModifier: 3 });
      expect(Math.abs(Math.log(open / 100))).toBeLessThanOrEqual(MAX_GAP + 1e-9);
    }
  });
});
