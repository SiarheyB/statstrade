// Плата за перенос плеча через ночь.
//
// До этого позиция «взял десятое плечо и забыл на месяц» не стоила ничего, и
// держать её было выгоднее, чем закрывать: у брокера заёмные деньги стоят
// процент в день, а у нас были бесплатны. Из-за этого исчезала вся разница
// между внутридневной торговлей и позиционной — а на этой разнице держатся
// торговые стили.
//
// Берём только за ЗАЁМНУЮ часть: без плеча позиция куплена своими деньгами,
// и брать за них проценты не за что.
import type { Position } from "@/engine/entities/types";

/** Годовая ставка по заёмным средствам. */
export const SWAP_ANNUAL_RATE = 0.09;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Плата за отрезок времени по одной позиции.
 *
 * Считается непрерывно, а не «раз в полночь»: игровое время идёт вровень с
 * реальным, и полночь — момент, к которому игрок не имеет отношения. Зато
 * закрыв позицию через час, он заплатит ровно за час.
 */
export function swapFee(position: Position, elapsedMs: number): number {
  if (position.leverage <= 1 || elapsedMs <= 0) return 0;
  const notional = position.entryPrice * position.size * position.leverage;
  // Своя часть — notional/leverage; заёмная — всё остальное.
  const borrowed = notional * (1 - 1 / position.leverage);
  return borrowed * SWAP_ANNUAL_RATE * (elapsedMs / YEAR_MS);
}

/** Суммарная плата по всем открытым позициям за отрезок. */
export function totalSwapFee(positions: Position[], elapsedMs: number): number {
  let total = 0;
  for (const position of positions) {
    if (position.closedAt != null) continue;
    total += swapFee(position, elapsedMs);
  }
  return total;
}
