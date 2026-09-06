// Догон за время отсутствия: что случилось со счётом, пока вкладка была
// закрыта.
//
// Раньше здесь заново прокручивалась симуляция цен. Теперь рынок общий и
// живёт на сервере, поэтому догон — это не «досимулировать», а ПРИМЕНИТЬ
// то, что на рынке уже произошло: пройти по историческим свечам своих
// позиций и посмотреть, задело ли стоп или тейк.
//
// Так честнее и проще: цена за время отсутствия — объективный факт, одна и
// та же для всех игроков, а не результат отдельного прогона в одном
// конкретном браузере.
import { applyPositionClose, MONTH_MS, type GameState } from "@/engine/gameLoop";
import { DIVIDEND_PERIOD_MS } from "@/engine/gameLoop";
import { processQuarterlyDividends } from "@/engine/economy/dividends";
import { chargeUpkeep, monthlyUpkeep, restFactor } from "@/engine/economy/shop";
import { evaluateContract, applyContractReward, getContract } from "@/engine/player/contracts";
import { perkEffects } from "@/engine/player/perks";
import { recoverOverTime } from "@/engine/player/psychology";
import { TRADING_STYLE_CONFIGS } from "@/engine/entities/tradingStyleConfigs";
import type { Account, Candle } from "@/engine/entities/types";

// Отчёт показываем только после заметного перерыва: «прошло четыре минуты» —
// это не новость, а раздражение.
export const MIN_REPORT_MS = 6 * 60 * 60 * 1000;

export interface OfflineReport {
  gameDays: number;
  equityBefore: number;
  equityAfter: number;
  balanceChange: number;
  tradesClosed: number;
  newsCount: number;
  contractFinished: string | null;
}

export interface OfflineResult {
  state: GameState;
  report: OfflineReport | null;
}

/**
 * Первая свеча, в которой цена задела уровень. Внутри бара порядок движения
 * неизвестен, поэтому при попадании и стопа, и тейка в один бар считаем
 * сработавшим СТОП — так делают все честные тестеры стратегий: считать
 * иначе значит систематически завышать результат.
 */
export function firstTouch(
  candles: Candle[],
  side: "long" | "short",
  stopLoss: number | undefined,
  takeProfit: number | undefined,
): { price: number; ts: number } | null {
  for (const candle of candles) {
    if (side === "long") {
      if (stopLoss != null && candle.low <= stopLoss) return { price: stopLoss, ts: candle.timestamp };
      if (takeProfit != null && candle.high >= takeProfit) return { price: takeProfit, ts: candle.timestamp };
    } else {
      if (stopLoss != null && candle.high >= stopLoss) return { price: stopLoss, ts: candle.timestamp };
      if (takeProfit != null && candle.low <= takeProfit) return { price: takeProfit, ts: candle.timestamp };
    }
  }
  return null;
}

export interface CatchUpInput {
  /** Свечи по инструментам открытых позиций за время отсутствия. */
  history: Record<string, Candle[]>;
  /** Текущие цены с сервера. */
  prices: Record<string, number>;
  /** Сколько реального времени прошло с последнего сохранения. */
  elapsedMs: number;
  /** Текущий момент — игровое время идёт вровень с реальным. */
  now: number;
}

/**
 * Применяет к счёту всё, что накопилось за время отсутствия. Мутаций
 * состояния снаружи нет: возвращается новое.
 */
export function catchUp(state: GameState, input: CatchUpInput): OfflineResult {
  const { history, prices, elapsedMs } = input;
  if (!(elapsedMs > 0)) return { state, report: null };

  const equityBefore = state.account.equity;
  const balanceBefore = state.account.balance;
  const tradesBefore = state.account.journal.length;
  const contractBefore = state.contracts.active?.contractId ?? null;

  const perks = perkEffects(state.perks);
  const account: Account = {
    ...state.account,
    positions: [...state.account.positions],
    journal: [...state.account.journal],
  };

  const gameElapsedMs = state.gameElapsedMs + elapsedMs;
  const gameCalendarDay = Math.floor(gameElapsedMs / (24 * 60 * 60 * 1000));

  // 1. Позиции: закрываем те, чей стоп или тейк задело за время отсутствия.
  for (const position of [...account.positions]) {
    if (position.closedAt) continue;
    if (position.stopLoss == null && position.takeProfit == null) continue;
    const touch = firstTouch(history[position.assetId] ?? [], position.side, position.stopLoss, position.takeProfit);
    if (!touch) continue;
    applyPositionClose(
      account,
      position,
      touch.price,
      TRADING_STYLE_CONFIGS[position.style].commissionRate * perks.commissionMultiplier,
      0,
      state.tuning.xpMultiplier * perks.xpMultiplier,
      gameCalendarDay,
    );
  }

  // 2. Дивиденды и содержание — за каждый пройденный период.
  let lastDividendQuarter = state.lastDividendQuarter;
  const currentDividendPeriod = Math.floor(gameElapsedMs / DIVIDEND_PERIOD_MS);
  while (lastDividendQuarter < currentDividendPeriod) {
    lastDividendQuarter++;
    processQuarterlyDividends(
      account,
      state.activeAssets,
      prices,
      state.tuning.dividendMultiplier * perks.dividendMultiplier,
    );
  }

  let lifestyle = state.lifestyle;
  let lastUpkeepMonth = state.lastUpkeepMonth;
  const currentMonth = Math.floor(gameElapsedMs / MONTH_MS);
  const upkeep = monthlyUpkeep(lifestyle) * state.tuning.upkeepMultiplier * perks.upkeepMultiplier;
  while (lastUpkeepMonth < currentMonth) {
    lastUpkeepMonth++;
    if (upkeep > 0) lifestyle = chargeUpkeep(account, lifestyle, upkeep).lifestyle;
  }

  // 3. Психология отдыхает: за ночь без торговли стресс уходит.
  account.psychology = recoverOverTime(account.psychology, elapsedMs, restFactor(lifestyle));

  // 4. Пересчёт эквити и проверка контракта по её итогу.
  let unrealized = 0;
  let marginUsed = 0;
  for (const position of account.positions) {
    if (position.closedAt != null) continue;
    const price = prices[position.assetId];
    if (price != null) {
      const direction = position.side === "long" ? 1 : -1;
      unrealized += (price - position.entryPrice) * position.size * position.leverage * direction;
    }
    marginUsed += (position.entryPrice * position.size) / position.leverage;
  }
  account.equity = account.balance + unrealized;
  account.marginUsed = marginUsed;
  account.marginLevel = marginUsed > 0 ? (account.equity / marginUsed) * 100 : Infinity;

  const evaluation = evaluateContract(state.contracts, account.equity, gameCalendarDay);
  let contractPoints = state.contractPoints;
  let unlockedMarkets = state.unlockedMarkets;
  if (evaluation.finished?.outcome === "passed") {
    const contract = getContract(evaluation.finished.contractId);
    if (contract) {
      applyContractReward(account, contract);
      contractPoints += contract.reward.skillPoints;
      unlockedMarkets = Array.from(new Set([...unlockedMarkets, ...contract.reward.unlockMarkets]));
    }
  }

  const next: GameState = {
    ...state,
    account,
    prices,
    lifestyle,
    lastUpkeepMonth,
    lastDividendQuarter,
    gameElapsedMs,
    gameCalendarDay,
    dayStartEquity: account.equity,
    contracts: evaluation.state,
    contractPoints,
    unlockedMarkets,
    lastContractResult: evaluation.finished ?? state.lastContractResult,
  };

  if (elapsedMs < MIN_REPORT_MS) return { state: next, report: null };

  return {
    state: next,
    report: {
      gameDays: Math.round(elapsedMs / (24 * 60 * 60 * 1000)),
      equityBefore,
      equityAfter: account.equity,
      balanceChange: account.balance - balanceBefore,
      tradesClosed: account.journal.length - tradesBefore,
      newsCount: 0, // ленту приносит сервер отдельно
      contractFinished:
        contractBefore && evaluation.state.active?.contractId !== contractBefore ? contractBefore : null,
    },
  };
}
