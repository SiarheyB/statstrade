// Разорение и путь обратно.
//
// До сих пор ветки на нулевом капитале не было вовсе: игрок, потерявший всё,
// оставался с мёртвым счётом, на котором нельзя ни открыть позицию, ни
// проиграть дальше, — и уходил. Между тем именно разорение случается с
// новичком чаще всего, и именно оно должно быть самой сильной сценой игры, а
// не её концом.
//
// Ответ — СПОНСОР. Кто-то даёт разорившемуся трейдеру денег под долю в
// будущей прибыли: половину стартового капитала сейчас в обмен на треть
// каждой прибыльной сделки, пока не вернётся полторы ставки. Это не подарок
// и не наказание: игра продолжается сразу, но следующие несколько недель
// работаешь не только на себя. Ровно так живут настоящие трейдеры в
// prop-firm, с которых списаны и контракты.
import type { Position, SponsorDeal } from "@/engine/entities/types";

export type { SponsorDeal };


// Порог разорения — доля от стартового капитала. Не ноль: счёт, на котором
// осталось два процента, торговым уже не является (позицию на нём не
// открыть), и заставлять игрока досливать эти проценты вручную незачем.
export const WIPEOUT_THRESHOLD_PCT = 3;
// Ставка спонсора — половина стартового капитала. Не полный: возвращение
// должно ощущаться как второй шанс, а не как отмена проигрыша.
export const SPONSOR_STAKE_PCT = 50;
// Доля прибыли и сколько всего придётся вернуть.
export const SPONSOR_SHARE_PCT = 30;
export const SPONSOR_REPAY_MULTIPLIER = 1.5;
// Разорение стоит репутации: без цены оно превратилось бы в способ
// бесплатно перезагружать счёт, когда сделка не пошла.
export const WIPEOUT_PRESTIGE_PENALTY = 25;

/**
 * Разорён ли счёт: денег почти нет И нечего больше закрывать.
 *
 * Второе условие обязательно: пока открыта хотя бы одна позиция, эквити
 * может вернуться сама, и предлагать спонсора человеку, который прямо сейчас
 * сидит в просадке по живой сделке, — значит выталкивать его из неё.
 */
export function isWipedOut(equity: number, positions: Position[], startingBalance: number): boolean {
  const open = positions.some((p) => !p.closedAt);
  if (open) return false;
  return equity <= startingBalance * (WIPEOUT_THRESHOLD_PCT / 100);
}

/** Условия сделки, которые предложат разорившемуся. */
export function sponsorOffer(startingBalance: number, now = Date.now()): SponsorDeal {
  const stake = Math.round(startingBalance * (SPONSOR_STAKE_PCT / 100));
  return {
    stake,
    owed: Math.round(stake * SPONSOR_REPAY_MULTIPLIER),
    sharePct: SPONSOR_SHARE_PCT,
    signedAt: now,
    settledTrades: 0,
  };
}

/**
 * Доля спонсора с прибыльной сделки.
 *
 * Только с прибыльной: брать долю с убытка означало бы углублять яму, из
 * которой договор и должен вытащить.
 */
export function sponsorCut(deal: SponsorDeal | null, realizedPnl: number): number {
  if (!deal || deal.owed <= 0 || realizedPnl <= 0) return 0;
  return Math.min(deal.owed, realizedPnl * (deal.sharePct / 100));
}

/** Состояние договора после удержания. null — долг закрыт. */
export function applySponsorCut(deal: SponsorDeal, cut: number, settledTrades: number): SponsorDeal | null {
  const owed = Math.max(0, deal.owed - cut);
  return owed > 0 ? { ...deal, owed, settledTrades } : null;
}
