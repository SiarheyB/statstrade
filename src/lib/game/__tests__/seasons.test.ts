import { describe, it, expect } from "vitest";
import {
  seasonPrize,
  seasonReturnPct,
  SEASON_MIN_PLAYERS,
  SEASON_LENGTH_DAYS,
  SEASON_PRIZE_PLACES,
  SEASON_TOP_PRIZE,
} from "@/lib/game/seasons";

describe("зачёт сезона", () => {
  it("считается рост от входной эквити, а не абсолютные деньги", () => {
    // Иначе сезон выигрывал бы тот, кто просто дольше играет, и повторял бы
    // общий рейтинг.
    expect(seasonReturnPct(12_000, 10_000)).toBeCloseTo(20, 6);
    expect(seasonReturnPct(9_000, 10_000)).toBeCloseTo(-10, 6);
    // Богатый, но не выросший, проигрывает бедному, но выросшему.
    expect(seasonReturnPct(1_000_000, 1_000_000)).toBeLessThan(seasonReturnPct(1_100, 1_000));
  });

  it("без отметки входа результат нулевой, а не бесконечный", () => {
    expect(seasonReturnPct(10_000, null)).toBe(0);
    expect(seasonReturnPct(10_000, 0)).toBe(0);
  });
});

describe("награды сезона", () => {
  it("первое место берёт полную ставку, дальше по убыванию", () => {
    expect(seasonPrize(1).cash).toBe(SEASON_TOP_PRIZE);
    expect(seasonPrize(2).cash).toBeLessThan(seasonPrize(1).cash);
    expect(seasonPrize(3).cash).toBeLessThan(seasonPrize(2).cash);
  });

  it("за пределами призовых мест награды нет", () => {
    expect(seasonPrize(SEASON_PRIZE_PLACES).cash).toBeGreaterThan(0);
    expect(seasonPrize(SEASON_PRIZE_PLACES + 1).cash).toBe(0);
    expect(seasonPrize(0).cash).toBe(0);
  });

  it("призовое место всегда даёт хотя бы единицу престижа", () => {
    for (let rank = 1; rank <= SEASON_PRIZE_PLACES; rank++) {
      expect(seasonPrize(rank).prestige).toBeGreaterThanOrEqual(1);
    }
  });

  it("пороги заданы осмысленно", () => {
    expect(SEASON_LENGTH_DAYS).toBeGreaterThan(7);
    // Меньше трёх участников — первое место достаётся за факт присутствия.
    expect(SEASON_MIN_PLAYERS).toBeGreaterThanOrEqual(2);
  });
});
