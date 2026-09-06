// Ежедневные задания — то, ради чего игрок заходит завтра.
//
// Три задачи на игровой день, одинаковые для всех и предсказуемые: набор
// выбирается детерминированно по номеру дня, поэтому игрок может увидеть
// задание и спланировать под него сессию, а не гадать. Награда маленькая по
// деньгам и заметная по опыту: задания должны подталкивать к привычкам
// (ставить стоп, не сидеть в одной бумаге), а не заменять торговлю.
import type { Asset, JournalEntry, Position } from "@/engine/entities/types";

export type DailyTaskKind = "close_trades" | "use_stops" | "profit_day" | "diversify" | "survive";

export interface DailyTask {
  id: string;
  kind: DailyTaskKind;
  target: number;
  rewardCash: number;
  rewardXp: number;
}

// Пул заданий. Порядок фиксирован — из него по номеру дня выбираются три.
export const TASK_POOL: Omit<DailyTask, "id">[] = [
  { kind: "close_trades", target: 3, rewardCash: 300, rewardXp: 15 },
  { kind: "use_stops", target: 2, rewardCash: 400, rewardXp: 25 },
  { kind: "profit_day", target: 1, rewardCash: 500, rewardXp: 20 },
  { kind: "diversify", target: 3, rewardCash: 350, rewardXp: 20 },
  { kind: "survive", target: 1, rewardCash: 250, rewardXp: 10 },
  { kind: "close_trades", target: 5, rewardCash: 500, rewardXp: 25 },
  { kind: "use_stops", target: 4, rewardCash: 700, rewardXp: 35 },
  { kind: "diversify", target: 5, rewardCash: 600, rewardXp: 30 },
];

export interface DailyState {
  day: number;
  completedIds: string[];
}

export function freshDailyState(): DailyState {
  return { day: 0, completedIds: [] };
}

/**
 * Три задания дня. Выбор детерминирован от номера дня — без хранения в
 * сохранении и без случайности: одинаковый день даёт одинаковый набор и
 * после перезагрузки страницы.
 */
export function tasksForDay(day: number): DailyTask[] {
  const size = TASK_POOL.length;
  return [0, 1, 2].map((offset) => {
    // Шаг 3 вместо 1 — чтобы соседние дни не выдавали почти тот же набор.
    const index = (day * 3 + offset) % size;
    return { ...TASK_POOL[index], id: `D${day}-${index}` };
  });
}

export interface DailyContext {
  day: number;
  journal: JournalEntry[];
  positions: Position[];
  assets: Asset[];
  dayStartEquity: number;
  equity: number;
}

/** Текущий прогресс по заданию — число «сделано из target». */
export function taskProgress(task: DailyTask, ctx: DailyContext): number {
  switch (task.kind) {
    case "close_trades":
      return ctx.journal.filter((e) => e.gameDay === ctx.day).length;
    case "use_stops":
      // rMultiple считается только при выставленном стопе (см. applyPositionClose),
      // поэтому ненулевой R — это и есть «сделка была со стопом».
      return ctx.journal.filter((e) => e.gameDay === ctx.day && e.rMultiple !== 0).length;
    case "profit_day":
      return ctx.dayStartEquity > 0 && ctx.equity > ctx.dayStartEquity ? 1 : 0;
    case "diversify": {
      const sectors = new Set<string>();
      for (const position of ctx.positions) {
        if (position.closedAt != null) continue;
        const asset = ctx.assets.find((a) => a.id === position.assetId);
        if (asset?.sector) sectors.add(asset.sector);
        else if (asset) sectors.add(asset.assetClass);
      }
      return sectors.size;
    }
    case "survive":
      // «Пережить день»: ни одной ликвидации за сегодня. Ликвидация в журнале
      // выглядит как убыток с R хуже −1 (штраф сверх стопа).
      return ctx.journal.some((e) => e.gameDay === ctx.day && e.rMultiple < -1) ? 0 : 1;
  }
}

export function isComplete(task: DailyTask, ctx: DailyContext): boolean {
  return taskProgress(task, ctx) >= task.target;
}

export interface DailyResult {
  state: DailyState;
  rewardCash: number;
  rewardXp: number;
  completed: DailyTask[];
}

/**
 * Проверяет задания дня и выдаёт награду за только что закрытые. Смена дня
 * обнуляет список выполненных: задания новые, начинаем заново.
 *
 * Задание «пережить день» намеренно НЕ выдаётся сразу (оно выполнено с утра
 * по умолчанию) — награда за него приходит вместе со сменой дня, иначе игрок
 * получал бы её, ещё не начав торговать.
 */
export function evaluateDaily(state: DailyState, ctx: DailyContext): DailyResult {
  if (state.day !== ctx.day) {
    return { state: { day: ctx.day, completedIds: [] }, rewardCash: 0, rewardXp: 0, completed: [] };
  }
  const completed: DailyTask[] = [];
  let rewardCash = 0;
  let rewardXp = 0;
  const completedIds = [...state.completedIds];
  for (const task of tasksForDay(ctx.day)) {
    if (completedIds.includes(task.id)) continue;
    if (task.kind === "survive") continue; // засчитывается при смене дня
    if (!isComplete(task, ctx)) continue;
    completedIds.push(task.id);
    completed.push(task);
    rewardCash += task.rewardCash;
    rewardXp += task.rewardXp;
  }
  return { state: { day: ctx.day, completedIds }, rewardCash, rewardXp, completed };
}
