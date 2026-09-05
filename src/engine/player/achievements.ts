// Достижения и серия заходов.
//
// Самый дешёвый в разработке контент с самым прямым действием на возвраты:
// цели уже есть в игре, достижения просто называют их вслух и отмечают
// момент, когда игрок что-то сделал впервые. Без них прогресс между
// контрактами не виден вообще — а между контрактами проходят дни.
//
// Проверяются по состоянию, а не по событиям: правило «пять прибыльных
// сделок подряд» одинаково срабатывает и на живой сделке, и на догоняющем
// офлайн-прогрессе, и после восстановления сохранения. Событийная модель
// потребовала бы ловить каждый путь закрытия позиции по отдельности и
// молчала бы ровно там, где игрок отсутствовал.
import type { AssetClass, JournalEntry, Position, SkillTree, StreakState } from "@/engine/entities/types";

export type { StreakState };

export interface AchievementContext {
  positions: Position[];
  journal: JournalEntry[];
  skills: SkillTree;
  contractsPassed: number;
  unlockedMarkets: AssetClass[];
  equity: number;
  startingBalance: number;
  streakDays: number;
  /** Долг спонсору закрыт — то есть игрок вернулся с нуля. */
  sponsorRepaid: boolean;
  /** Стратегию игрока купили хотя бы раз (приходит из мира). */
  strategySold: boolean;
  /** Игрок состоит в фонде. */
  inFund: boolean;
}

export interface Achievement {
  id: string;
  /** Скрытые не показываются до получения — они про редкие моменты. */
  hidden?: boolean;
  check: (ctx: AchievementContext) => boolean;
}

/** Максимальная серия подряд идущих прибыльных сделок. */
export function bestWinStreak(journal: JournalEntry[]): number {
  let best = 0;
  let current = 0;
  // Журнал хранится «новые сверху», поэтому идём с конца — от старых сделок.
  for (let i = journal.length - 1; i >= 0; i--) {
    if (journal[i].pnl > 0) {
      current++;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

const maxSkillLevel = (skills: SkillTree): number =>
  Math.max(0, ...Object.values(skills).map((s) => s?.level ?? 0));

export const ACHIEVEMENTS: Achievement[] = [
  { id: "firstTrade", check: (c) => c.journal.length >= 1 },
  { id: "firstProfit", check: (c) => c.journal.some((j) => j.pnl > 0) },
  { id: "streak5", check: (c) => bestWinStreak(c.journal) >= 5 },
  { id: "trades100", check: (c) => c.journal.length >= 100 },
  { id: "bigWin", check: (c) => c.journal.some((j) => j.rMultiple >= 3) },
  { id: "firstContract", check: (c) => c.contractsPassed >= 1 },
  { id: "allContracts", check: (c) => c.contractsPassed >= 5 },
  { id: "level5", check: (c) => maxSkillLevel(c.skills) >= 5 },
  { id: "threeMarkets", check: (c) => c.unlockedMarkets.length >= 3 },
  { id: "doubled", check: (c) => c.equity >= c.startingBalance * 2 },
  { id: "inFund", check: (c) => c.inFund },
  { id: "strategySold", check: (c) => c.strategySold },
  { id: "week", check: (c) => c.streakDays >= 7 },
  { id: "month", check: (c) => c.streakDays >= 30 },
  // Скрытые: называть их заранее — значит превратить редкий момент в задание.
  { id: "comeback", hidden: true, check: (c) => c.sponsorRepaid },
  {
    id: "diamondHands",
    hidden: true,
    // Позиция, прожившая больше недели. Игровое время идёт вровень с
    // реальным, поэтому это ровно неделя терпения.
    check: (c) =>
      c.positions.some((p) => p.closedAt != null && p.closedAt - p.openedAt >= 7 * 24 * 60 * 60_000),
  },
];

export function getAchievement(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** Достижения, полученные ИМЕННО СЕЙЧАС (уже полученные не повторяются). */
export function newlyEarned(unlocked: string[], ctx: AchievementContext): string[] {
  const have = new Set(unlocked);
  return ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.check(ctx)).map((a) => a.id);
}

// ── Серия заходов ─────────────────────────────────────────────────────────


export const DAY_MS = 24 * 60 * 60_000;

export function freshStreak(): StreakState {
  return { days: 0, lastDay: -1, best: 0 };
}

/** Номер календарных суток — по ним и считается «зашёл сегодня». */
export function dayNumber(now: number): number {
  return Math.floor(now / DAY_MS);
}

/**
 * Отметить заход.
 *
 * Пропуск обнуляет текущую серию, но не лучшую: отнимать у игрока рекорд за
 * то, что он один день не пришёл, — это наказание, которое запоминается
 * лучше самой игры.
 */
export function touchStreak(state: StreakState, now: number): StreakState {
  const today = dayNumber(now);
  if (state.lastDay === today) return state;
  const days = state.lastDay === today - 1 ? state.days + 1 : 1;
  return { days, lastDay: today, best: Math.max(state.best, days) };
}

/**
 * Награда за серию, в игровых долларах.
 *
 * Растёт, но упирается в потолок: иначе на тридцатый день заходить выгоднее,
 * чем торговать, и игра превращается в календарь.
 */
export const STREAK_DAILY_REWARD = 150;
export const STREAK_MAX_MULTIPLIER = 7;

export function streakReward(days: number): number {
  if (days <= 0) return 0;
  return STREAK_DAILY_REWARD * Math.min(days, STREAK_MAX_MULTIPLIER);
}
