import { describe, it, expect } from "vitest";
import { catchUp, firstTouch, MIN_REPORT_MS } from "@/engine/offline";
import { type GameState } from "@/engine/gameLoop";
import { makeRegime } from "@/engine/market/marketRegime";
import { TRADING_STYLE_CONFIGS } from "@/engine/entities/tradingStyleConfigs";
import { DEFAULT_TUNING } from "@/engine/entities/tuning";
import { freshLifestyle } from "@/engine/economy/shop";
import { freshContractState } from "@/engine/player/contracts";
import { freshPerkState } from "@/engine/player/perks";
import { freshDailyState } from "@/engine/player/dailyTasks";
import type { Account, Asset, Candle, Position } from "@/engine/entities/types";

const asset: Asset = {
  id: "STK_TEST",
  symbol: "TEST",
  name: "Test",
  assetClass: "stock",
  correlationGroup: "g",
  baseVolatility: 0.3,
  baseDrift: 0.05,
  startPrice: 100,
  tickSize: 0.01,
  tradingHours: "session",
};

function candle(ts: number, low: number, high: number): Candle {
  return { timestamp: ts, open: (low + high) / 2, high, low, close: (low + high) / 2, volume: 10 };
}

function position(overrides: Partial<Position> = {}): Position {
  return {
    id: "p1",
    assetId: asset.id,
    side: "long",
    entryPrice: 100,
    size: 10,
    leverage: 1,
    openedAt: 0,
    fees: 0,
    style: "day",
    ...overrides,
  };
}

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "a",
    balance: 10_000,
    equity: 10_000,
    positions: [],
    pendingOrders: [],
    marginUsed: 0,
    marginLevel: Infinity,
    psychology: { stress: 30, confidence: 50, discipline: 50, consecutiveWins: 0, consecutiveLosses: 0, lastTradeAt: 0 },
    skills: {},
    reputation: 0,
    licenses: [],
    journal: [],
    ...overrides,
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
    newsFeed: [],
    dayChange: {},
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

const HOUR = 60 * 60 * 1000;

describe("firstTouch", () => {
  it("находит бар, в котором цена задела стоп", () => {
    const series = [candle(0, 99, 101), candle(1000, 94, 100), candle(2000, 98, 103)];
    expect(firstTouch(series, "long", 95, undefined)).toEqual({ price: 95, ts: 1000 });
  });

  it("если в одном баре задело и стоп, и тейк — считаем стоп", () => {
    // Порядок движения внутри бара неизвестен; считать иначе значит
    // систематически завышать результат стратегии.
    const series = [candle(0, 90, 120)];
    expect(firstTouch(series, "long", 95, 110)).toEqual({ price: 95, ts: 0 });
  });

  it("для шорта стороны зеркальны", () => {
    const series = [candle(0, 99, 106)];
    expect(firstTouch(series, "short", 105, 90)).toEqual({ price: 105, ts: 0 });
    expect(firstTouch([candle(0, 88, 95)], "short", 105, 90)).toEqual({ price: 90, ts: 0 });
  });

  it("не задело — null", () => {
    expect(firstTouch([candle(0, 99, 101)], "long", 95, 110)).toBeNull();
    expect(firstTouch([], "long", 95, 110)).toBeNull();
  });
});

describe("catchUp", () => {
  it("нулевое отсутствие ничего не меняет", () => {
    const before = state();
    const result = catchUp(before, { history: {}, prices: { [asset.id]: 100 }, elapsedMs: 0, now: Date.now() });
    expect(result.state).toBe(before);
    expect(result.report).toBeNull();
  });

  it("закрывает позицию, чей стоп задело за время отсутствия", () => {
    const start = state({ account: account({ positions: [position({ stopLoss: 95 })] }) });
    const history = { [asset.id]: [candle(0, 99, 101), candle(60_000, 93, 99)] };
    const result = catchUp(start, { history, prices: { [asset.id]: 97 }, elapsedMs: 8 * HOUR, now: Date.now() });
    const closed = result.state.account.positions[0];
    expect(closed.closedAt).toBeDefined();
    expect(closed.closePrice).toBe(95);
    expect(result.report?.tradesClosed).toBe(1);
  });

  it("позицию без стопа и тейка не трогает — её закрывать нечем", () => {
    const start = state({ account: account({ positions: [position()] }) });
    const history = { [asset.id]: [candle(0, 50, 60)] };
    const result = catchUp(start, { history, prices: { [asset.id]: 55 }, elapsedMs: 8 * HOUR, now: Date.now() });
    expect(result.state.account.positions[0].closedAt).toBeUndefined();
  });

  it("списывает содержание за каждый пройденный месяц", () => {
    const lifestyle = { ...freshLifestyle(), ownedItemIds: ["life_studio"] }; // 900/мес
    const start = state({ lifestyle, account: account({ balance: 10_000 }) });
    const result = catchUp(start, {
      history: {},
      prices: { [asset.id]: 100 },
      elapsedMs: 62 * 24 * HOUR, // два месяца с хвостиком
      now: Date.now(),
    });
    expect(result.state.account.balance).toBe(10_000 - 2 * 900);
  });

  it("стресс за время отсутствия спадает", () => {
    const result = catchUp(state(), { history: {}, prices: { [asset.id]: 100 }, elapsedMs: 2 * 24 * HOUR, now: Date.now() });
    expect(result.state.account.psychology.stress).toBeLessThan(30);
  });

  it("игровое время догоняет реальное", () => {
    const result = catchUp(state(), { history: {}, prices: { [asset.id]: 100 }, elapsedMs: 3 * 24 * HOUR, now: Date.now() });
    expect(result.state.gameElapsedMs).toBe(3 * 24 * HOUR);
    expect(result.state.gameCalendarDay).toBe(3);
  });

  it("отчёт появляется только после заметного перерыва", () => {
    const short = catchUp(state(), { history: {}, prices: { [asset.id]: 100 }, elapsedMs: MIN_REPORT_MS / 2, now: Date.now() });
    const long = catchUp(state(), { history: {}, prices: { [asset.id]: 100 }, elapsedMs: MIN_REPORT_MS * 2, now: Date.now() });
    expect(short.report).toBeNull();
    expect(long.report).not.toBeNull();
    // но состояние догнано в обоих случаях — иначе календарь отстанет
    expect(short.state.gameElapsedMs).toBeGreaterThan(0);
  });

  it("эквити пересчитывается по актуальным ценам", () => {
    const start = state({ account: account({ balance: 9_000, positions: [position()] }) });
    const result = catchUp(start, { history: {}, prices: { [asset.id]: 110 }, elapsedMs: 8 * HOUR, now: Date.now() });
    // 10 бумаг * (110 − 100) = +100 нереализованной прибыли
    expect(result.state.account.equity).toBeCloseTo(9_100, 6);
  });
});
