// Офлайн-прогресс: что произошло, пока вкладка была закрыта.
//
// Это главный крючок браузерных экономических игр — вернуться и увидеть, что
// без тебя что-то случилось. До этого симуляция стояла: закрыл вкладку в
// среду, открыл в пятницу — та же свеча, тот же день, разбирать нечего.
//
// Три правила, без которых механика превращается в чит или в наказание:
//
//   1. Потолок в ИГРОВЫХ днях, а не в реальных часах. На investing (43200x)
//      двенадцать реальных часов — это 59 игровых ЛЕТ: рынок ушёл бы в
//      бесконечность, а игрок вернулся бы к руинам. Считаем не больше
//      MAX_OFFLINE_GAME_DAYS игровых дней, сколько бы человек ни отсутствовал.
//   2. Число шагов ограничено. Прогонять 172 800 тиков за отсутствие ночью —
//      это секунды фризов на открытии страницы; берём не больше MAX_STEPS
//      шагов покрупнее. Для GBM это корректно: процесс непрерывный, шаг
//      входит в формулу.
//   3. Позиции живут своей жизнью, и стопы работают. Это не жестокость, а
//      единственный честный вариант: удержание позиции через ночь — риск, и
//      именно стоп от него защищает. Игра ровно этому и учит.
import { gameTick, type GameState } from "@/engine/gameLoop";

export const MAX_OFFLINE_GAME_DAYS = 30;
export const MAX_STEPS = 400;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface OfflineReport {
  gameDays: number;
  equityBefore: number;
  equityAfter: number;
  balanceChange: number;
  tradesClosed: number;
  newsCount: number;
  contractFinished: string | null; // id завершившегося контракта, если он закрылся без игрока
}

export interface OfflineResult {
  state: GameState;
  // null — либо перерыв был совсем коротким (ничего не считали), либо
  // недостаточно длинным, чтобы показывать окно (рынок при этом досчитан).
  report: OfflineReport | null;
}

// Отчёт показываем только после заметного перерыва: «прошло 4 минуты» —
// это не новость, а раздражение.
export const MIN_REPORT_GAME_MS = 6 * 60 * 60 * 1000; // 6 часов

// А вот СИМУЛИРОВАТЬ надо любой перерыв длиннее полуминуты: время в игре
// идёт вровень с реальным, и если пропускать короткие отлучки, игровой
// календарь начнёт отставать от настоящего — день в игре перестанет
// означать день. Полминуты — порог, ниже которого это просто перезагрузка
// страницы.
export const MIN_SIMULATE_MS = 30 * 1000;

/**
 * Прокручивает симуляцию на время отсутствия. realElapsedMs — сколько
 * реального времени прошло с последнего сохранения.
 */
export function simulateOffline(state: GameState, realElapsedMs: number, rng: () => number): OfflineResult {
  if (!(realElapsedMs > 0)) return { state, report: null };
  const acceleration = state.activeStyle.timeAcceleration;
  const wantedGameMs = realElapsedMs * acceleration;
  const cappedGameMs = Math.min(wantedGameMs, MAX_OFFLINE_GAME_DAYS * MS_PER_DAY);
  if (cappedGameMs < MIN_SIMULATE_MS) return { state, report: null };

  const equityBefore = state.account.equity;
  const balanceBefore = state.account.balance;
  const tradesBefore = state.account.journal.length;
  const newsBefore = state.newsFeed.length;
  const contractBefore = state.contracts.active?.contractId ?? null;

  const steps = Math.min(MAX_STEPS, Math.max(1, Math.round(cappedGameMs / (1000 * acceleration))));
  const dtRealPerStep = cappedGameMs / acceleration / steps;

  let next = state;
  for (let i = 0; i < steps; i++) next = gameTick(dtRealPerStep, next, rng);

  const contractFinished =
    contractBefore && next.contracts.active?.contractId !== contractBefore ? contractBefore : null;

  // Короткая отлучка симулируется молча: рынок сходится с реальным временем,
  // но окном «пока тебя не было» игрока не дёргаем.
  if (cappedGameMs < MIN_REPORT_GAME_MS) return { state: next, report: null };

  return {
    state: next,
    report: {
      gameDays: Math.round(cappedGameMs / MS_PER_DAY),
      equityBefore,
      equityAfter: next.account.equity,
      balanceChange: next.account.balance - balanceBefore,
      tradesClosed: next.account.journal.length - tradesBefore,
      newsCount: next.newsFeed.length - newsBefore,
      contractFinished,
    },
  };
}
