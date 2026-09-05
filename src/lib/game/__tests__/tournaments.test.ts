import { describe, it, expect } from "vitest";
import {
  prizeShare,
  returnPct,
  TOURNAMENT_DAYS,
  TOURNAMENT_ENTRY_FEE,
  TOURNAMENT_MIN_PLAYERS,
  TOURNAMENT_PRIZE_PLACES,
  TOURNAMENT_PRIZE_SHARES,
} from "@/lib/game/tournaments";

describe("зачёт турнира", () => {
  it("считается рост от эквити на входе, а не абсолютные деньги", () => {
    // Иначе турнир выигрывал бы самый богатый, просто придя.
    expect(returnPct(11_000, 10_000)).toBeCloseTo(10, 6);
    expect(returnPct(1_100, 1_000)).toBeCloseTo(returnPct(1_100_000, 1_000_000), 6);
  });

  it("без отметки входа результат нулевой, а не бесконечный", () => {
    expect(returnPct(10_000, 0)).toBe(0);
  });
});

describe("призовой фонд", () => {
  it("делится между призовыми местами целиком", () => {
    const total = TOURNAMENT_PRIZE_SHARES.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 9);
    expect(TOURNAMENT_PRIZE_SHARES.length).toBe(TOURNAMENT_PRIZE_PLACES);
  });

  it("первое место берёт больше второго, второе — больше третьего", () => {
    expect(prizeShare(1)).toBeGreaterThan(prizeShare(2));
    expect(prizeShare(2)).toBeGreaterThan(prizeShare(3));
  });

  it("за пределами призовых мест доли нет", () => {
    expect(prizeShare(TOURNAMENT_PRIZE_PLACES + 1)).toBe(0);
    expect(prizeShare(0)).toBe(0);
  });

  it("параметры турнира заданы осмысленно", () => {
    // Короткая дистанция: месяц — это уже сезон.
    expect(TOURNAMENT_DAYS).toBeGreaterThan(0);
    expect(TOURNAMENT_DAYS).toBeLessThanOrEqual(7);
    // Взнос обязателен: без него турнир — бесплатная лотерея.
    expect(TOURNAMENT_ENTRY_FEE).toBeGreaterThan(0);
    // Турнир из двух человек — обмен взносами, а не соревнование.
    expect(TOURNAMENT_MIN_PLAYERS).toBeGreaterThanOrEqual(3);
  });
});
