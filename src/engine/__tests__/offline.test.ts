import { describe, it, expect } from "vitest";
import { simulateOffline, MAX_OFFLINE_GAME_DAYS, MIN_REPORT_GAME_MS, MIN_SIMULATE_MS } from "@/engine/offline";
import { type GameState } from "@/engine/gameLoop";
import { NEUTRAL_REGIME } from "@/engine/entities/types";
import { makeRegime } from "@/engine/market/marketRegime";
import { TRADING_STYLE_CONFIGS } from "@/engine/entities/tradingStyleConfigs";
import { DEFAULT_TUNING } from "@/engine/entities/tuning";
import { freshLifestyle } from "@/engine/economy/shop";
import { freshContractState } from "@/engine/player/contracts";
import { freshPerkState } from "@/engine/player/perks";
import { freshDailyState } from "@/engine/player/dailyTasks";
import { mulberry32 } from "@/engine/rng";
import type { Account, Asset } from "@/engine/entities/types";

const asset: Asset = {
  id: "STK_TEST",
  symbol: "TEST",
  name: "Test",
  assetClass: "stock",
  correlationGroup: "g",
  baseVolatility: 0.3,
  baseDrift: 0.05,
  tickSize: 0.01,
  tradingHours: "session",
};

function account(): Account {
  return {
    id: "a",
    balance: 10_000,
    equity: 10_000,
    positions: [],
    pendingOrders: [],
    marginUsed: 0,
    marginLevel: Infinity,
    psychology: { stress: 0, confidence: 50, discipline: 0, consecutiveWins: 0, consecutiveLosses: 0, lastTradeAt: 0 },
    skills: {},
    reputation: 0,
    licenses: [],
    journal: [],
  };
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    account: account(),
    marketRegime: makeRegime("sideways"),
    prices: { [asset.id]: 100 },
    candles: {},
    activeAssets: [asset],
    activeStyle: TRADING_STYLE_CONFIGS.day,
    gameCalendarDay: 0,
    gameElapsedMs: 0,
    lastDividendQuarter: 0,
    lifestyle: freshLifestyle(),
    lastUpkeepMonth: 0,
    activeNews: [],
    newsFeed: [],
    dayStartEquity: 10_000,
    tuning: DEFAULT_TUNING,
    contracts: freshContractState(),
    perks: freshPerkState(),
    contractPoints: 0,
    unlockedMarkets: ["stock"],
    lastContractResult: null,
    daily: freshDailyState(),
    lastDailyCompleted: [],
    bots: [],
    drawings: {},
    ...overrides,
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("simulateOffline", () => {
  it("перезагрузка страницы ничего не считает и не двигает игру", () => {
    const before = state();
    const result = simulateOffline(before, 1_000, mulberry32(1)); // 1 секунда
    expect(result.report).toBeNull();
    expect(result.state).toBe(before);
  });

  // Время идёт вровень с реальным, поэтому короткие отлучки нельзя
  // пропускать: иначе игровой календарь отстанет от настоящего.
  it("короткая отлучка досчитывается молча — рынок не отстаёт от реального времени", () => {
    const result = simulateOffline(state(), 20 * 60 * 1000, mulberry32(9)); // 20 минут
    expect(result.report).toBeNull();
    expect(result.state.gameElapsedMs).toBeGreaterThan(19 * 60 * 1000);
    expect(MIN_SIMULATE_MS).toBeLessThan(MIN_REPORT_GAME_MS);
  });

  it("отсутствие подольше двигает игровое время и цену", () => {
    const before = state();
    // Время идёт вровень с реальным: сутки отсутствия — это игровые сутки.
    const result = simulateOffline(before, 24 * 60 * 60 * 1000, mulberry32(2));
    expect(result.report).not.toBeNull();
    expect(result.state.gameElapsedMs).toBeGreaterThan(0);
    expect(result.state.prices[asset.id]).not.toBe(100);
    expect(result.report!.gameDays).toBe(1);
  });

  it("потолок: полгода без игры не превращаются в полгода симуляции", () => {
    const result = simulateOffline(state(), 180 * 24 * 60 * 60 * 1000, mulberry32(3));
    expect(result.report!.gameDays).toBe(MAX_OFFLINE_GAME_DAYS);
    expect(result.state.gameElapsedMs).toBeLessThanOrEqual(MAX_OFFLINE_GAME_DAYS * MS_PER_DAY + 1);
  });

  it("не зависает на длинном отсутствии — число шагов ограничено", () => {
    const started = Date.now();
    simulateOffline(state(), 7 * 24 * 60 * 60 * 1000, mulberry32(4));
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("окно «пока тебя не было» появляется только после заметного перерыва", () => {
    expect(simulateOffline(state(), MIN_REPORT_GAME_MS / 2, mulberry32(5)).report).toBeNull();
    expect(simulateOffline(state(), MIN_REPORT_GAME_MS * 2, mulberry32(5)).report).not.toBeNull();
  });

  it("отчёт считает закрытые сделки и вышедшие новости", () => {
    const result = simulateOffline(state(), 12 * 60 * 60 * 1000, mulberry32(7));
    expect(result.report!.newsCount).toBeGreaterThanOrEqual(0);
    expect(result.report!.tradesClosed).toBeGreaterThanOrEqual(0);
    expect(result.report!.equityBefore).toBe(10_000);
  });

  it("нейтральный режим из старых сохранений не ломает прогон", () => {
    const result = simulateOffline(state({ marketRegime: NEUTRAL_REGIME }), 12 * 60 * 60 * 1000, mulberry32(8));
    expect(result.state.prices[asset.id]).toBeGreaterThan(0);
  });
});
