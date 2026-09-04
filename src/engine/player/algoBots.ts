// Алго-боты: стратегия, которая торгует без игрока — в том числе пока
// вкладка закрыта (см. engine/offline.ts).
//
// Это вторая половина ответа на вопрос «зачем возвращаться»: отчёт «пока
// тебя не было» становится интересным, когда в нём есть не только движение
// цены, но и то, что твоя собственная стратегия наделала за ночь.
//
// Осознанные ограничения, чтобы бот не превратился в кнопку «победить»:
//   • слоты дают только перки (ветка algo) — бот это награда за прогресс;
//   • у бота ОБЯЗАТЕЛЬНЫ стоп и тейк: автомат без стопа сливает счёт за ночь
//     и учит ровно неправильному;
//   • одна открытая позиция на бота — усреднение вниз автоматом это худшее,
//     чему может научить игра;
//   • сигналы считаются по тем же свечам, что видит игрок: никакого
//     «знания будущего».
import type { Candle, Position, PositionSide } from "@/engine/entities/types";

export type BotStrategy = "trend" | "meanReversion" | "breakout";

export interface AlgoBot {
  id: string;
  assetId: string;
  strategy: BotStrategy;
  riskPct: number; // доля БАЛАНСА, которой рискуем в одной сделке (1 = 1%)
  stopPct: number; // стоп в процентах от цены входа
  takePct: number; // тейк в процентах от цены входа
  enabled: boolean;
}

export const MIN_CANDLES_FOR_SIGNAL = 25;
export const FAST_WINDOW = 5;
export const SLOW_WINDOW = 20;
export const MEAN_REVERSION_BAND_PCT = 2;

export function defaultBot(assetId: string): Omit<AlgoBot, "id"> {
  return { assetId, strategy: "trend", riskPct: 1, stopPct: 2, takePct: 4, enabled: true };
}

function sma(candles: Candle[], window: number): number | null {
  if (candles.length < window) return null;
  const slice = candles.slice(-window);
  return slice.reduce((sum, c) => sum + c.close, 0) / window;
}

/**
 * Сигнал бота или null. Считается по закрытым свечам инструмента — тем же
 * данным, что нарисованы у игрока на графике.
 */
export function botSignal(bot: AlgoBot, candles: Candle[], price: number): PositionSide | null {
  if (candles.length < MIN_CANDLES_FOR_SIGNAL) return null;
  const fast = sma(candles, FAST_WINDOW);
  const slow = sma(candles, SLOW_WINDOW);
  if (fast == null || slow == null) return null;

  if (bot.strategy === "trend") {
    // Классическое пересечение средних: быстрая выше медленной — тренд вверх.
    if (fast > slow * 1.001) return "long";
    if (fast < slow * 0.999) return "short";
    return null;
  }

  if (bot.strategy === "meanReversion") {
    const band = slow * (MEAN_REVERSION_BAND_PCT / 100);
    if (price < slow - band) return "long";
    if (price > slow + band) return "short";
    return null;
  }

  // breakout: выход за экстремум окна.
  const window = candles.slice(-SLOW_WINDOW);
  const high = Math.max(...window.map((c) => c.high));
  const low = Math.min(...window.map((c) => c.low));
  if (price >= high) return "long";
  if (price <= low) return "short";
  return null;
}

/** Размер позиции из риска: рискуем riskPct процентов баланса до стопа. */
export function botPositionSize(balance: number, price: number, bot: AlgoBot): number {
  const riskMoney = balance * (bot.riskPct / 100);
  const riskPerUnit = price * (bot.stopPct / 100);
  if (!(riskPerUnit > 0)) return 0;
  return Math.max(0, riskMoney / riskPerUnit);
}

export function botStopLoss(price: number, side: PositionSide, bot: AlgoBot): number {
  return side === "long" ? price * (1 - bot.stopPct / 100) : price * (1 + bot.stopPct / 100);
}

export function botTakeProfit(price: number, side: PositionSide, bot: AlgoBot): number {
  return side === "long" ? price * (1 + bot.takePct / 100) : price * (1 - bot.takePct / 100);
}

/** Есть ли у бота уже открытая позиция по своему инструменту. */
export function botHasPosition(bot: AlgoBot, positions: Position[]): boolean {
  return positions.some((p) => p.closedAt == null && p.assetId === bot.assetId);
}

/** Сколько слотов ботов доступно — считается по перкам ветки algo. */
export function botSlots(unlockedPerks: string[]): number {
  let slots = 0;
  if (unlockedPerks.includes("PK_ALGO_DESK")) slots += 1;
  if (unlockedPerks.includes("PK_ALGO_FARM")) slots += 1;
  return slots;
}
