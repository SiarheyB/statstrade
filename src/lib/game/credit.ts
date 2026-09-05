// Кредитный скоринг и залог.
//
// Как это делают настоящие банки. Решение о кредите складывается из трёх
// вопросов, и ни один нельзя пропустить:
//
//   1. КТО ЭТО. Кредитная история: платил ли раньше, были ли просрочки и
//      банкротства. У нас есть прямые аналоги — репутация заёмщика (падает за
//      просрочку), число объявленных банкротств, возраст счёта.
//   2. ЧЕМ БУДЕТ ПЛАТИТЬ. Доход и долговая нагрузка. В банках это DTI —
//      отношение платежей к доходу; выше 40-50% кредит не дают. У нас роль
//      дохода играет капитал: заёмщик с большим счётом обслужит больший долг.
//   3. ЧТО ОСТАНЕТСЯ, ЕСЛИ НЕ ЗАПЛАТИТ. Залог и LTV — какую долю от стоимости
//      вещи банк готов выдать. Доли взяты близкими к рыночным: недвижимость
//      70%, транспорт 50%, предметы роскоши 40%. Разница не произвольна: чем
//      быстрее и предсказуемее вещь продаётся, тем больше под неё дают.
//
// Скоринговый балл считается по шкале 300-850, как в FICO: она привычна и
// сразу читается — «700 это хорошо, 450 это плохо».
import { getShopItem } from "@/engine/economy/shop";
import type { ShopItem } from "@/engine/entities/types";

export const MIN_SCORE = 300;
export const MAX_SCORE = 850;

export interface CreditProfile {
  /** Репутация заёмщика 0-100: падает за просрочку (см. lib/game/loans). */
  reliability: number;
  /** Сколько раз объявлял себя банкротом. */
  bankruptcies: number;
  /** Пройденные испытания — доказанная состоятельность. */
  contractsPassed: number;
  /** Капитал: чем больше, тем больший долг заёмщик обслужит. */
  equity: number;
  /** Уже взятые и не возвращённые кредиты. */
  currentDebt: number;
  /** Возраст счёта в днях: у вчерашнего заёмщика истории нет. */
  ageDays: number;
}

/**
 * Кредитный балл 300-850.
 *
 * Веса расставлены так же, как в реальных скоринговых картах: тяжелее всего
 * платёжная дисциплина, затем долговая нагрузка, затем возраст истории.
 */
export function creditScore(profile: CreditProfile): number {
  // Платёжная дисциплина — самый тяжёлый фактор (в FICO это 35%).
  const discipline = (profile.reliability / 100) * 0.35;

  // Долговая нагрузка: отношение долга к капиталу. Ноль долга — максимум,
  // долг вровень с капиталом — ноль. В банках это DTI, и выше 40-50% кредит
  // просто не выдают.
  const load = profile.equity > 0 ? Math.min(1, profile.currentDebt / profile.equity) : 1;
  const burden = (1 - load) * 0.3;

  // Возраст истории: полгода уже считается историей.
  const age = Math.min(1, profile.ageDays / 180) * 0.15;

  // Доказанная состоятельность: пройденные испытания.
  const track = Math.min(1, profile.contractsPassed / 5) * 0.2;

  // Банкротство бьёт сильно и надолго — как в жизни.
  const penalty = Math.min(0.6, profile.bankruptcies * 0.3);

  const raw = Math.max(0, discipline + burden + age + track - penalty);
  return Math.round(MIN_SCORE + raw * (MAX_SCORE - MIN_SCORE));
}

export type ScoreBand = "excellent" | "good" | "fair" | "poor" | "bad";

export function scoreBand(score: number): ScoreBand {
  if (score >= 740) return "excellent";
  if (score >= 670) return "good";
  if (score >= 580) return "fair";
  if (score >= 500) return "poor";
  return "bad";
}

/** Базовая ставка банка, годовых. */
export const BASE_RATE_PCT = 9;

/**
 * Годовая ставка по баллу.
 *
 * Надбавка за риск: чем хуже история, тем дороже деньги. Разброс от базовой
 * до примерно вчетверо дороже — как между ипотечной ставкой и ставкой по
 * необеспеченному потребкредиту у ненадёжного заёмщика.
 */
export function rateFor(score: number, secured: boolean): number {
  const premium: Record<ScoreBand, number> = {
    excellent: 0,
    good: 3,
    fair: 8,
    poor: 16,
    bad: 28,
  };
  const rate = BASE_RATE_PCT + premium[scoreBand(score)];
  // Обеспеченный кредит дешевле: банку есть что забрать, риск ниже.
  return secured ? Math.max(BASE_RATE_PCT * 0.7, rate * 0.65) : rate;
}

/**
 * Потолок кредита БЕЗ обеспечения.
 *
 * Считается от капитала, а не «сколько попросил»: банк смотрит, чем заёмщик
 * будет платить. Доля растёт с баллом — от четверти капитала у плохого
 * заёмщика до полутора у отличного. Уже взятое вычитается: две суммы по
 * потолку — это тот же потолок, взятый дважды.
 */
export function unsecuredLimit(score: number, equity: number, currentDebt: number): number {
  const share: Record<ScoreBand, number> = {
    excellent: 1.5,
    good: 1,
    fair: 0.6,
    poor: 0.25,
    bad: 0,
  };
  return Math.max(0, equity * share[scoreBand(score)] - currentDebt);
}

// ── Залог ─────────────────────────────────────────────────────────────────

/**
 * Какую долю стоимости банк выдаёт под вещь (LTV).
 *
 * Доли близки к рыночным: недвижимость закладывают под 70%, транспорт под
 * 50%, предметы роскоши под 40%. Разница не произвольна — чем быстрее и
 * предсказуемее вещь продаётся, тем больше под неё дают. Яхту продать
 * труднее квартиры, поэтому и дисконт больше.
 */
export const LTV_BY_CATEGORY: Record<string, number> = {
  lifestyle: 0.7,
  status: 0.4,
  gear: 0.3,
  theme: 0,
};

/** Сколько дадут под конкретный предмет. */
export function collateralLoan(item: ShopItem): number {
  const ltv = LTV_BY_CATEGORY[item.category] ?? 0.3;
  return Math.floor(item.price * ltv);
}

/** Годится ли предмет в залог: за копеечные вещи банк возиться не станет. */
export const MIN_COLLATERAL_PRICE = 1_000;

export function canPledge(itemId: string): boolean {
  const item = getShopItem(itemId);
  if (!item) return false;
  return item.price >= MIN_COLLATERAL_PRICE && (LTV_BY_CATEGORY[item.category] ?? 0) > 0;
}

/**
 * Цена изъятой вещи на витрине банка.
 *
 * Со скидкой: банку нужны деньги, а не яхта, и продать быстро можно только
 * дешевле рынка. Для остальных игроков это способ купить дорогую вещь
 * заметно дешевле магазина — оборотная сторона чужой просрочки.
 */
export const REPOSSESSION_DISCOUNT = 0.7;

export function repossessionPrice(item: ShopItem): number {
  return Math.floor(item.price * REPOSSESSION_DISCOUNT);
}
