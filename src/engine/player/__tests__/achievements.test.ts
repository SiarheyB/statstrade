import { describe, it, expect } from "vitest";
import {
  ACHIEVEMENTS,
  bestWinStreak,
  dayNumber,
  DAY_MS,
  freshStreak,
  newlyEarned,
  streakReward,
  STREAK_DAILY_REWARD,
  STREAK_MAX_MULTIPLIER,
  touchStreak,
  type AchievementContext,
} from "@/engine/player/achievements";
import type { JournalEntry } from "@/engine/entities/types";

const entry = (pnl: number, rMultiple = 0): JournalEntry => ({
  id: crypto.randomUUID(),
  positionId: "p",
  timestampClosed: 0,
  gameDay: 0,
  pnl,
  rMultiple,
  tags: [],
});

const ctx = (patch: Partial<AchievementContext> = {}): AchievementContext => ({
  positions: [],
  journal: [],
  skills: {},
  contractsPassed: 0,
  unlockedMarkets: ["stock"],
  equity: 10_000,
  startingBalance: 10_000,
  streakDays: 0,
  sponsorRepaid: false,
  strategySold: false,
  inFund: false,
  ...patch,
});

describe("серия прибыльных сделок", () => {
  it("считает самую длинную, а не последнюю", () => {
    // Журнал хранится «новые сверху»: три подряд лежат в конце массива.
    const journal = [entry(-1), entry(5), entry(5), entry(5), entry(-1), entry(5)];
    expect(bestWinStreak(journal)).toBe(3);
  });

  it("убыток обрывает серию", () => {
    expect(bestWinStreak([entry(5), entry(-1), entry(5)])).toBe(1);
  });

  it("пустой журнал — ноль", () => {
    expect(bestWinStreak([])).toBe(0);
  });
});

describe("выдача достижений", () => {
  it("выдаёт только новые, уже полученные не повторяет", () => {
    const first = newlyEarned([], ctx({ journal: [entry(100)] }));
    expect(first).toContain("firstTrade");
    expect(first).toContain("firstProfit");
    const second = newlyEarned(first, ctx({ journal: [entry(100)] }));
    expect(second).toEqual([]);
  });

  it("удвоение считается от стартового капитала, а не от круглого числа", () => {
    expect(newlyEarned([], ctx({ equity: 19_999 }))).not.toContain("doubled");
    expect(newlyEarned([], ctx({ equity: 20_000 }))).toContain("doubled");
  });

  it("скрытые достижения существуют и не выдаются просто так", () => {
    const hidden = ACHIEVEMENTS.filter((a) => a.hidden).map((a) => a.id);
    expect(hidden.length).toBeGreaterThan(0);
    const earned = newlyEarned([], ctx({ journal: [entry(100)] }));
    for (const id of hidden) expect(earned).not.toContain(id);
  });

  it("возвращение с нуля выдаётся только после закрытия долга", () => {
    expect(newlyEarned([], ctx({ sponsorRepaid: true }))).toContain("comeback");
  });

  it("у всех достижений уникальные идентификаторы", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("серия заходов", () => {
  const day = (n: number) => n * DAY_MS + 12 * 60 * 60_000;

  it("первый заход открывает серию", () => {
    const s = touchStreak(freshStreak(), day(100));
    expect(s.days).toBe(1);
    expect(s.lastDay).toBe(dayNumber(day(100)));
  });

  it("повторный заход в те же сутки ничего не меняет", () => {
    const first = touchStreak(freshStreak(), day(100));
    expect(touchStreak(first, day(100) + 60_000)).toBe(first);
  });

  it("заход на следующий день продлевает серию", () => {
    let s = touchStreak(freshStreak(), day(100));
    s = touchStreak(s, day(101));
    s = touchStreak(s, day(102));
    expect(s.days).toBe(3);
  });

  it("пропуск обнуляет текущую серию, но не рекорд", () => {
    let s = freshStreak();
    for (let i = 0; i < 5; i++) s = touchStreak(s, day(100 + i));
    expect(s.days).toBe(5);
    const afterGap = touchStreak(s, day(120));
    expect(afterGap.days).toBe(1);
    expect(afterGap.best).toBe(5);
  });

  it("награда растёт, но упирается в потолок — иначе заходить выгоднее, чем торговать", () => {
    expect(streakReward(0)).toBe(0);
    expect(streakReward(1)).toBe(STREAK_DAILY_REWARD);
    expect(streakReward(3)).toBe(STREAK_DAILY_REWARD * 3);
    expect(streakReward(100)).toBe(STREAK_DAILY_REWARD * STREAK_MAX_MULTIPLIER);
  });
});
