/**
 * «Бюджет хода» — сколько ATR инструменту нужно пройти СЕГОДНЯ, чтобы сетап
 * состоялся, и насколько такой день вообще типичен.
 *
 * Зачем отдельный модуль: в карточке рекомендации цифра `1.16×ATR` сама по
 * себе ничего не говорит — трейдер видит «до уровня ещё 40% цены» и не
 * понимает, реально ли пройти это за день. Здесь считается требуемый размах
 * бара и сопоставляется со статистикой дневных ходов из конспекта.
 */

import { DEFAULT_THRESHOLDS } from "./quality";

/**
 * Распределение дневных ходов (конспект, раздел ATR): 1 ATR инструмент
 * проходит примерно в 80% дней, 2 ATR — в 10%, 3 ATR — в 5%, больше 3 — в 2%.
 * Значения трактуем как «доля дней, когда бар прошёл ПРИМЕРНО столько»:
 * ориентир для оценки реалистичности, а не точная вероятность.
 */
export const DAY_MOVE_ODDS = [
  { maxAtr: 1, share: 0.8 },
  { maxAtr: 2, share: 0.1 },
  { maxAtr: 3, share: 0.05 },
  { maxAtr: Infinity, share: 0.02 },
] as const;

export type MoveFeasibility = "routine" | "stretch" | "unlikely";

export interface AtrBudget {
  /** Путь от текущей цены до уровня, в ATR. */
  toLevelAtr: number;
  /** Прокол за уровень — минимальная глубина, с которой это уже ложный пробой. */
  pierceAtr: number;
  /** Итого размах, который должен показать дневной бар. */
  totalAtr: number;
  /** То же в цене инструмента. */
  totalPrice: number;
  /** Доля дней с таким ходом по статистике конспекта (0..1). */
  oddsShare: number;
  /** Насколько это обычный день: до 1 ATR / до 2 ATR / дальше. */
  feasibility: MoveFeasibility;
}

/** Доля дней, когда инструмент проходит не меньше `atrMove` своих ATR. */
export function dayMoveOdds(atrMove: number): number {
  if (!Number.isFinite(atrMove) || atrMove <= 0) return 1;
  const bucket = DAY_MOVE_ODDS.find((b) => atrMove <= b.maxAtr) ?? DAY_MOVE_ODDS[DAY_MOVE_ODDS.length - 1];
  return bucket.share;
}

function feasibilityOf(totalAtr: number): MoveFeasibility {
  if (totalAtr <= 1) return "routine";
  if (totalAtr <= 2) return "stretch";
  return "unlikely";
}

/**
 * Бюджет хода для ложного пробоя: сегодняшний бар должен дойти до уровня,
 * проколоть его и вернуться. Размах бара (хай минус лоу) при этом обязан
 * покрыть путь до уровня плюс глубину прокола — возврат укладывается внутрь
 * того же размаха, поэтому дважды путь не считаем.
 */
export function falseBreakoutBudget(
  price: number,
  levelPrice: number,
  atr: number,
  pierceAtr = DEFAULT_THRESHOLDS.minPierceAtr,
): AtrBudget | null {
  if (!(atr > 0) || !Number.isFinite(price) || !Number.isFinite(levelPrice)) return null;
  const toLevelAtr = Math.abs(price - levelPrice) / atr;
  const totalAtr = toLevelAtr + pierceAtr;
  return {
    toLevelAtr,
    pierceAtr,
    totalAtr,
    totalPrice: totalAtr * atr,
    oddsShare: dayMoveOdds(totalAtr),
    feasibility: feasibilityOf(totalAtr),
  };
}

/**
 * Сколько от дневного ATR инструмент уже прошёл сегодня. Конспект: пройденные
 * 75% ATR разворачивают приоритет в сторону контртрендовых сделок — «бензин»
 * на сегодня почти выработан.
 */
export interface TodayProgress {
  /** Размах текущего (незакрытого) бара в ATR. */
  movedAtr: number;
  /** Он же в процентах ATR — как в терминалах. */
  movedPct: number;
  /** Пройдено 75% ATR и больше. */
  exhausted: boolean;
  /** Остаток дневного хода в ATR (0, если ATR уже выбран). */
  leftAtr: number;
}

export function todayProgress(high: number, low: number, atr: number): TodayProgress | null {
  if (!(atr > 0) || !Number.isFinite(high) || !Number.isFinite(low) || high < low) return null;
  const movedAtr = (high - low) / atr;
  return {
    movedAtr,
    movedPct: movedAtr * 100,
    exhausted: movedAtr >= 0.75,
    leftAtr: Math.max(0, 1 - movedAtr),
  };
}

/**
 * Бюджет хода для ЛП2Б: пробойный бар уже случился и закрылся ЗА уровнем,
 * поэтому завтрашнему бару нужно не дойти до уровня, а вернуть цену обратно —
 * пройти то, что ушло за уровень, плюс заход под него. Величина считается
 * детектором (returnMoveAtr) и здесь только переводится в цену и вердикт.
 */
export function returnMoveBudget(returnMoveAtr: number, atr: number): AtrBudget | null {
  if (!(atr > 0) || !Number.isFinite(returnMoveAtr) || returnMoveAtr < 0) return null;
  return {
    toLevelAtr: 0,
    pierceAtr: 0,
    totalAtr: returnMoveAtr,
    totalPrice: returnMoveAtr * atr,
    oddsShare: dayMoveOdds(returnMoveAtr),
    feasibility: feasibilityOf(returnMoveAtr),
  };
}
