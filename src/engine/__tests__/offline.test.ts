import { describe, it, expect } from "vitest";
import { simulateOffline, MAX_OFFLINE_GAME_DAYS, MIN_OFFLINE_GAME_MS } from "@/engine/offline";
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
    ...overrides,
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("simulateOffline", () => {
  it("короткое отсутствие не даёт отчёта и не двигает игру", () => {
    const before = state();
    const result = simulateOffline(before, 1_000, mulberry32(1)); // 1 секунда
    expect(result.report).toBeNull();
    expect(result.state).toBe(before);
  });

  it("отсутствие подольше двигает игровое время и цену", () => {
    const before = state();
    // day = 60x: два реальных часа — это пять игровых суток
    const result = simulateOffline(before, 2 * 60 * 60 * 1000, mulberry32(2));
    expect(result.report).not.toBeNull();
    expect(result.state.gameElapsedMs).toBeGreaterThan(0);
    expect(result.state.prices[asset.id]).not.toBe(100);
    expect(result.report!.gameDays).toBe(5);
  });

  it("потолок в игровых днях: месяц отсутствия не превращается в годы", () => {
    // investing (43200x): сутки отсутствия — это 118 игровых лет без потолка
    const result = simulateOffline(
      state({ activeStyle: TRADING_STYLE_CONFIGS.investing }),
      24 * 60 * 60 * 1000,
      mulberry32(3),
    );
    expect(result.report!.gameDays).toBe(MAX_OFFLINE_GAME_DAYS);
    expect(result.state.gameElapsedMs).toBeLessThanOrEqual(MAX_OFFLINE_GAME_DAYS * MS_PER_DAY + 1);
  });

  it("не зависает на длинном отсутствии — число шагов ограничено", () => {
    const started = Date.now();
    simulateOffline(state(), 7 * 24 * 60 * 60 * 1000, mulberry32(4));
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("порог отсечения выражен в игровом времени, а не в реальном", () => {
    // На investing даже несколько секунд отсутствия — это игровые дни.
    const fast = simulateOffline(state({ activeStyle: TRADING_STYLE_CONFIGS.investing }), 30_000, mulberry32(5));
    expect(fast.report).not.toBeNull();
    // А на скальпинге (1x) те же 30 секунд — это 30 секунд, отчёта нет.
    const slow = simulateOffline(state({ activeStyle: TRADING_STYLE_CONFIGS.scalping }), 30_000, mulberry32(5));
    expect(slow.report).toBeNull();
    expect(MIN_OFFLINE_GAME_MS).toBeGreaterThan(0);
  });

  it("отчёт считает закрытые сделки и вышедшие новости", () => {
    const result = simulateOffline(state(), 6 * 60 * 60 * 1000, mulberry32(7));
    expect(result.report!.newsCount).toBeGreaterThanOrEqual(0);
    expect(result.report!.tradesClosed).toBeGreaterThanOrEqual(0);
    expect(result.report!.equityBefore).toBe(10_000);
  });

  it("нейтральный режим из старых сохранений не ломает прогон", () => {
    const result = simulateOffline(state({ marketRegime: NEUTRAL_REGIME }), 3 * 60 * 60 * 1000, mulberry32(8));
    expect(result.state.prices[asset.id]).toBeGreaterThan(0);
  });
});
