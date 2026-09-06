import { describe, it, expect } from "vitest";
import { applyXpGain, calculateXpGain, xpToNextLevel, BASE_XP, MAX_SKILL_LEVEL } from "@/engine/player/progression";

describe("xpToNextLevel", () => {
  it("= round(100 * (level+1)^1.5)", () => {
    expect(xpToNextLevel(0)).toBe(100); // 100*1^1.5
    expect(xpToNextLevel(1)).toBe(283); // 100*2^1.5 ≈ 282.84 → round 283
  });

  it("растёт с уровнем", () => {
    expect(xpToNextLevel(5)).toBeGreaterThan(xpToNextLevel(1));
  });
});

describe("calculateXpGain", () => {
  it("прибыльная сделка с хорошим R:R даёт больше опыта, чем без бонуса", () => {
    const flat = calculateXpGain(BASE_XP, 0, "day"); // rMultipleBonus=1
    const good = calculateXpGain(BASE_XP, 2, "day"); // rMultipleBonus=1.6
    expect(good).toBeGreaterThan(flat);
  });

  it("бонус за R:R ограничен снизу 0.5 и сверху 3 (даже при экстремальном rMultiple)", () => {
    const veryBad = calculateXpGain(BASE_XP, -100, "day");
    const veryGood = calculateXpGain(BASE_XP, 100, "day");
    expect(veryBad).toBeCloseTo(BASE_XP * 0.5 * 1.2, 5);
    expect(veryGood).toBeCloseTo(BASE_XP * 3 * 1.2, 5);
  });

  it("более сложный стиль даёт больше опыта при равном результате", () => {
    const day = calculateXpGain(BASE_XP, 1, "day");
    const scalping = calculateXpGain(BASE_XP, 1, "scalping");
    expect(scalping).toBeGreaterThan(day);
  });
});

describe("applyXpGain", () => {
  it("копит xp без перехода на новый уровень, если порог не достигнут", () => {
    const next = applyXpGain({ level: 0, xp: 0, xpToNextLevel: xpToNextLevel(0) }, 50);
    expect(next.level).toBe(0);
    expect(next.xp).toBe(50);
  });

  it("переходит на новый уровень, перенося остаток xp (не сгорает)", () => {
    // level0→1 требует 100xp; даём 130 — 30 остатка переносится.
    const next = applyXpGain({ level: 0, xp: 0, xpToNextLevel: xpToNextLevel(0) }, 130);
    expect(next.level).toBe(1);
    expect(next.xp).toBe(30);
    expect(next.xpToNextLevel).toBe(xpToNextLevel(1));
  });

  it("может перепрыгнуть несколько уровней за один крупный прирост", () => {
    const next = applyXpGain({ level: 0, xp: 0, xpToNextLevel: xpToNextLevel(0) }, 1000);
    expect(next.level).toBeGreaterThan(1);
  });

  it("останавливается на MAX_SKILL_LEVEL, не начисляет xp сверху", () => {
    const capped = applyXpGain({ level: MAX_SKILL_LEVEL, xp: 0, xpToNextLevel: xpToNextLevel(MAX_SKILL_LEVEL) }, 10_000_000);
    expect(capped.level).toBe(MAX_SKILL_LEVEL);
  });
});
