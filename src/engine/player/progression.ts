// XP и уровни навыков — раздел 4.5 спеки. Это и есть «развитие трейдера»:
// каждая закрытая сделка (см. gameLoop.applyPositionClose) начисляет XP в
// account.skills[style] — видимый прогресс независимо от результата сделки
// (даже убыточная, но по плану, чему-то учит и даёт опыт), с бонусом за
// хороший R:R.
//
// xpToNextLevel(level) = 100 * (level + 1)^1.5
// xpGainedPerTrade = baseXp * rMultipleBonus * styleDifficultyMultiplier
// baseXp = 10
// rMultipleBonus = clamp(1 + rMultiple * 0.3, 0.5, 3)
import type { TradingStyle } from "@/engine/entities/types";

export const BASE_XP = 10;
export const MAX_SKILL_LEVEL = 10;

const STYLE_DIFFICULTY_MULTIPLIER: Record<TradingStyle, number> = {
  scalping: 1.5,
  day: 1.2,
  swing: 1.0,
  position: 0.9,
  investing: 0.7,
  algo: 1.8,
  arbitrage: 2.0,
  market_making: 2.2,
  options: 2.0,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function xpToNextLevel(currentLevel: number): number {
  return Math.round(100 * (currentLevel + 1) ** 1.5);
}

export function calculateXpGain(baseXp: number, rMultiple: number, style: TradingStyle): number {
  const rMultipleBonus = clamp(1 + rMultiple * 0.3, 0.5, 3);
  return baseXp * rMultipleBonus * STYLE_DIFFICULTY_MULTIPLIER[style];
}

export interface SkillProgress {
  level: number;
  xp: number;
  xpToNextLevel: number;
}

/**
 * Начисляет XP за сделку и поднимает уровень, если xp перевалил порог —
 * может перепрыгнуть несколько уровней разом (крупный выигрыш), остаток xp
 * переносится на новый уровень, а не сгорает. Останавливается на
 * MAX_SKILL_LEVEL — xp сверху просто не начисляется дальше.
 */
export function applyXpGain(current: SkillProgress, gain: number): SkillProgress {
  if (current.level >= MAX_SKILL_LEVEL) return current;
  let level = current.level;
  let xp = current.xp + gain;
  let need = xpToNextLevel(level);
  while (xp >= need && level < MAX_SKILL_LEVEL) {
    xp -= need;
    level++;
    need = xpToNextLevel(level);
  }
  if (level >= MAX_SKILL_LEVEL) {
    level = MAX_SKILL_LEVEL;
    xp = 0;
    need = xpToNextLevel(level);
  }
  return { level, xp, xpToNextLevel: need };
}
