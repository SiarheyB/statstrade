// Психология трейдера — раздел 4.4 спеки. Типы лежали с Фазы 1, но состояние
// не менялось никогда.
//
// Зачем механика: главная ошибка живого трейдера — не «неправильно посчитал»,
// а «психанул»: после серии убытков полез отыгрываться, увеличил плечо,
// перестал ставить стопы. Игра, в которой этого нет, учит только арифметике.
//
// Как это сделано честно, без «рандом решает за тебя»:
//   • стресс растёт от вещей, которые реально его вызывают — серия убытков,
//     крупное плечо, торговля в кризис, слишком частые сделки;
//   • эффект стресса ОДИН и предсказуемый — проскальзывание на исполнении
//     (нервный трейдер жмёт кнопку хуже). Никаких «случайно продали не то»;
//   • стресс лечится временем, дисциплиной (закрытие по плану) и отдыхом,
//     который покупается в магазине. Так покупки перестают быть витриной, но
//     НЕ становятся преимуществом на рынке: они возвращают тебя в норму, а
//     не делают сильнее нормы.
import type { PsychologyState } from "@/engine/entities/types";

export const MAX_STRESS = 100;
export const CALM_THRESHOLD = 40; // ниже — влияния на исполнение нет вовсе
export const HIGH_STRESS = 70;

// Проскальзывание при максимальном стрессе, доля цены. 0.2% — заметно на
// счёте, но не превращает торговлю в лотерею.
export const MAX_SLIPPAGE = 0.002;

// Сколько очков стресса уходит за игровые сутки спокойствия.
export const DAILY_RECOVERY = 12;

export function freshPsychology(): PsychologyState {
  return { stress: 0, confidence: 50, discipline: 50, consecutiveWins: 0, consecutiveLosses: 0, lastTradeAt: 0 };
}

function clamp(value: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, value));
}

export interface TradeOutcome {
  pnl: number;
  hadStop: boolean;
  leverage: number;
  liquidated: boolean;
}

/**
 * Реакция на закрытую сделку. Убыток сам по себе стресс не создаёт — создаёт
 * СЕРИЯ убытков, большое плечо и ликвидация. Это ровно те ситуации, после
 * которых живой человек начинает отыгрываться.
 */
export function applyTradeOutcome(psych: PsychologyState, outcome: TradeOutcome): PsychologyState {
  const win = outcome.pnl > 0;
  const consecutiveLosses = win ? 0 : psych.consecutiveLosses + 1;
  const consecutiveWins = win ? psych.consecutiveWins + 1 : 0;

  let stress = psych.stress;
  if (win) {
    stress -= 3;
  } else {
    // Первый убыток — мелочь, четвёртый подряд — уже болезненно.
    stress += 4 + consecutiveLosses * 2;
  }
  if (outcome.leverage > 3) stress += (outcome.leverage - 3) * 1.5;
  if (outcome.liquidated) stress += 15;
  // Закрытие по заранее выставленному стопу — это дисциплина, а не провал:
  // стресса такая сделка почти не добавляет.
  if (outcome.hadStop) stress -= 2;

  const discipline = clamp(psych.discipline + (outcome.hadStop ? 1.5 : -2.5));
  const confidence = clamp(psych.confidence + (win ? 3 : -4));

  return {
    ...psych,
    stress: clamp(stress, 0, MAX_STRESS),
    confidence,
    discipline,
    consecutiveWins,
    consecutiveLosses,
    lastTradeAt: Date.now(),
  };
}

/**
 * Восстановление со временем. restFactor — множитель от купленного отдыха
 * (дом у моря, кресло, кофе): он ускоряет возврат в норму, но не опускает
 * стресс ниже нуля и ничего не даёт сверх спокойного состояния.
 */
export function recoverOverTime(psych: PsychologyState, gameMsElapsed: number, restFactor = 1): PsychologyState {
  const days = gameMsElapsed / (24 * 60 * 60 * 1000);
  // Возвращаем ТОТ ЖЕ объект, только если менять действительно нечего:
  // уверенность сползает к нейтральной даже у спокойного игрока, и ранний
  // выход по одному лишь нулевому стрессу её замораживал.
  if (!(days > 0) || (psych.stress <= 0 && psych.confidence === 50)) return psych;
  const recovered = psych.stress - DAILY_RECOVERY * days * restFactor;
  // Уверенность тоже сползает к нейтральным 50: и эйфория, и уныние
  // проходят, если просто ничего не делать.
  const drift = Math.min(1, days * 0.5);
  return {
    ...psych,
    stress: clamp(recovered, 0, MAX_STRESS),
    confidence: clamp(psych.confidence + (50 - psych.confidence) * drift),
  };
}

/**
 * Проскальзывание при исполнении из-за стресса, доля цены. До CALM_THRESHOLD
 * — ноль: спокойный трейдер исполняется идеально.
 */
export function stressSlippage(stress: number): number {
  if (stress <= CALM_THRESHOLD) return 0;
  const excess = (stress - CALM_THRESHOLD) / (MAX_STRESS - CALM_THRESHOLD);
  return MAX_SLIPPAGE * excess;
}

/** Цена исполнения с учётом стресса — всегда НЕ в пользу игрока. */
export function applySlippage(price: number, side: "long" | "short", isEntry: boolean, stress: number): number {
  const slip = stressSlippage(stress);
  if (slip === 0) return price;
  // Вход в лонг — дороже, выход из лонга — дешевле; для шорта наоборот.
  const worseUp = isEntry === (side === "long");
  return worseUp ? price * (1 + slip) : price * (1 - slip);
}

export type StressLevel = "calm" | "tense" | "high";

export function stressLevel(stress: number): StressLevel {
  if (stress >= HIGH_STRESS) return "high";
  if (stress > CALM_THRESHOLD) return "tense";
  return "calm";
}
