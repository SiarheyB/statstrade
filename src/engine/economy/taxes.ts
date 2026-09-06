// Налог на прибыль и абонентская плата за инструменты.
//
// Обе статьи — про одно: в игре деньги только ПРИХОДИЛИ. Дивиденды, призы
// сезона, награды за испытания, проценты по займам — и ни одного регулярного
// расхода, кроме содержания купленных вещей. К концу прогрессии экономика
// переполнялась: деньги переставали что-либо значить, а вместе с ними —
// и решения про риск.
//
// НАЛОГ берётся с зафиксированной прибыли за период и только с прибыли:
// убыточный период налога не создаёт, а убыток переносится вперёд и
// уменьшает базу следующих периодов — ровно как в жизни. Без переноса игрок,
// заработавший сто и потерявший сто, платил бы налог со ста, оставшись при
// своих: это не строгость, это ошибка.
//
// АБОНПЛАТА за терминальные инструменты (стакан, скринер, радар) придаёт вес
// выбору в дереве перков: пока они открывались навсегда и бесплатно, взять
// их все было чистой арифметикой без решения.
import type { JournalEntry, TaxState } from "@/engine/entities/types";

export type { TaxState };

/** Ставка налога на зафиксированную прибыль, %. */
export const DEFAULT_TAX_RATE_PCT = 13;

/** Помесячная плата за каждый открытый инструмент терминала. */
export const TOOL_SUBSCRIPTION_COST = 250;


export function freshTaxState(): TaxState {
  return { settledTrades: 0, carriedLoss: 0, paidTotal: 0 };
}

export interface TaxResult {
  /** Сколько списать со счёта. */
  amount: number;
  state: TaxState;
}

/**
 * Налог за период по записям журнала, которые ещё не обложены.
 *
 * Считается по журналу, а не по балансу: журнал — единственное место, где
 * видны ЗАФИКСИРОВАННЫЕ результаты. Незакрытая прибыль налогом не облагается,
 * иначе игрок платил бы за то, чего ещё не получил.
 */
export function taxForPeriod(journal: JournalEntry[], state: TaxState, ratePct: number): TaxResult {
  const fresh = journal.slice(state.settledTrades);
  const settledTrades = journal.length;
  if (fresh.length === 0 || ratePct <= 0) {
    return { amount: 0, state: { ...state, settledTrades } };
  }

  const result = fresh.reduce((sum, entry) => sum + entry.pnl, 0);
  // Прошлый убыток сначала съедает текущую прибыль и только потом остаток
  // базы облагается.
  const base = result - state.carriedLoss;
  if (base <= 0) {
    // Math.abs, а не -base: при ровном нуле получался бы «минус ноль», и
    // сравнение переносимого убытка с нулём вело бы себя неожиданно.
    return { amount: 0, state: { settledTrades, carriedLoss: Math.abs(base), paidTotal: state.paidTotal } };
  }

  const amount = base * (ratePct / 100);
  return { amount, state: { settledTrades, carriedLoss: 0, paidTotal: state.paidTotal + amount } };
}

/** Помесячная плата за открытые инструменты терминала. */
export function toolSubscriptionCost(tools: { orderBookAnywhere: boolean; screener: boolean; newsRadar: boolean }): number {
  const count = [tools.orderBookAnywhere, tools.screener, tools.newsRadar].filter(Boolean).length;
  return count * TOOL_SUBSCRIPTION_COST;
}
