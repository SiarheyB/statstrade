import { describe, it, expect } from "vitest";
import { CANDLE_INTERVAL_MS, checkStopConditions, gameTick, type GameState } from "@/engine/gameLoop";
import { NEUTRAL_REGIME } from "@/engine/entities/types";
import type { Account, Asset, Position } from "@/engine/entities/types";
import { TRADING_STYLE_CONFIGS } from "@/engine/entities/tradingStyleConfigs";
import { mulberry32 } from "@/engine/rng";

const asset: Asset = {
  id: "STK_TEST",
  symbol: "TEST",
  name: "Test Co",
  assetClass: "stock",
  correlationGroup: "tech_stocks",
  baseVolatility: 0.32,
  baseDrift: 0.0,
  tickSize: 0.01,
  tradingHours: "session",
};

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc1",
    balance: 10000,
    equity: 10000,
    positions: [],
    pendingOrders: [],
    marginUsed: 0,
    marginLevel: Infinity,
    psychology: { stress: 0, confidence: 50, discipline: 0, consecutiveWins: 0, consecutiveLosses: 0, lastTradeAt: 0 },
    skills: {},
    reputation: 0,
    licenses: [],
    journal: [],
    ...overrides,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    account: makeAccount(),
    marketRegime: NEUTRAL_REGIME,
    prices: { [asset.id]: 100 },
    candles: {},
    activeAssets: [asset],
    activeStyle: TRADING_STYLE_CONFIGS.day,
    gameCalendarDay: 0,
    gameElapsedMs: 0,
    ...overrides,
  };
}

describe("checkStopConditions", () => {
  const base: Position = {
    id: "p1",
    assetId: asset.id,
    side: "long",
    entryPrice: 100,
    size: 10,
    leverage: 1,
    stopLoss: 90,
    takeProfit: 120,
    openedAt: 0,
    fees: 0,
    style: "day",
  };

  it("long: срабатывает SL при падении цены до/ниже стопа", () => {
    expect(checkStopConditions(base, 90)).toBe(90);
    expect(checkStopConditions(base, 85)).toBe(90);
  });

  it("long: срабатывает TP при росте цены до/выше тейка", () => {
    expect(checkStopConditions(base, 120)).toBe(120);
    expect(checkStopConditions(base, 130)).toBe(120);
  });

  it("long: не срабатывает между SL и TP", () => {
    expect(checkStopConditions(base, 105)).toBeNull();
  });

  it("short: направления инвертированы", () => {
    const short: Position = { ...base, side: "short", stopLoss: 110, takeProfit: 80 };
    expect(checkStopConditions(short, 110)).toBe(110);
    expect(checkStopConditions(short, 80)).toBe(80);
    expect(checkStopConditions(short, 95)).toBeNull();
  });

  it("приоритет у SL, если оба условия истинны в одном тике (edge case раздела 26)", () => {
    // Экстремальный гэп: цена перепрыгнула ОБА уровня за один тик.
    const gapped: Position = { ...base, stopLoss: 95, takeProfit: 96 };
    expect(checkStopConditions(gapped, 90)).toBe(95); // ниже обоих — стоп, не тейк
  });
});

describe("gameTick", () => {
  it("двигает игровое время на dtReal * timeAcceleration и обновляет цену активного актива", () => {
    const state = makeState();
    const rng = mulberry32(1);
    const next = gameTick(1000, state, rng); // 1 реальная секунда, day = x60
    expect(next.gameElapsedMs).toBe(60_000);
    expect(next.prices[asset.id]).not.toBe(100);
    expect(next.prices[asset.id]).toBeGreaterThan(0);
  });

  it("копит свечи в бакеты по CANDLE_INTERVAL_MS, не создавая лишних баров внутри одной минуты", () => {
    let state = makeState();
    const rng = mulberry32(2);
    // Дни-режим: 1 реальная секунда = 60 игровых секунд = 1 игровая минута —
    // после первого тика уже есть минимум одна свеча.
    state = gameTick(200, state, rng); // 200мс реала = 12с игровых — один бакет
    state = gameTick(200, state, rng); // ещё 12с игровых — тот же бакет (< 60с)
    expect(state.candles[asset.id].length).toBe(1);
    expect(state.candles[asset.id][0].timestamp).toBeLessThan(CANDLE_INTERVAL_MS);
    state = gameTick(3000, state, rng); // +180с игровых — новый бакет
    expect(state.candles[asset.id].length).toBeGreaterThan(1);
    expect(state.candles[asset.id].length).toBeLessThanOrEqual(500);
  });

  it("закрывает позицию по SL и возвращает на баланс резерв + realizedPnl (без утечки денег)", () => {
    const position: Position = {
      id: "p1",
      assetId: asset.id,
      side: "long",
      entryPrice: 100,
      size: 10,
      leverage: 1,
      stopLoss: 90,
      openedAt: 0,
      fees: 0,
      style: "day",
    };
    // Резерв, который должен был снять openPosition() в сторе: entry*size = 1000.
    const balanceAfterOpen = 10000 - 1000;
    const state = makeState({
      account: makeAccount({ balance: balanceAfterOpen, positions: [position] }),
      prices: { [asset.id]: 85 }, // уже ниже стопа — сработает немедленно
    });
    const rng = mulberry32(3);
    const next = gameTick(1, state, rng);
    const closed = next.account.positions.find((p) => p.id === "p1")!;
    expect(closed.closedAt).toBeDefined();
    // (90-100)*10 - fees, fees = (100*10 + 90*10) * commissionRate(day=0.0008) = 1.52
    const expectedFees = (100 * 10 + 90 * 10) * TRADING_STYLE_CONFIGS.day.commissionRate;
    expect(closed.realizedPnl).toBeCloseTo(-100 - expectedFees, 5);
    // balance должен вернуться к резерву + realizedPnl, без утечки/лишка.
    expect(next.account.balance).toBeCloseTo(balanceAfterOpen + 100 * 10 + closed.realizedPnl!, 5);
    expect(next.account.balance).toBeCloseTo(10000 - 100 - expectedFees, 5);
  });

  it("не трогает позиции без пересечения SL/TP", () => {
    const position: Position = {
      id: "p1",
      assetId: asset.id,
      side: "long",
      entryPrice: 100,
      size: 10,
      leverage: 1,
      stopLoss: 50,
      takeProfit: 200,
      openedAt: 0,
      fees: 0,
      style: "day",
    };
    const state = makeState({
      account: makeAccount({ positions: [position] }),
      prices: { [asset.id]: 100 },
    });
    const rng = mulberry32(4);
    const next = gameTick(1, state, rng);
    const still = next.account.positions.find((p) => p.id === "p1")!;
    expect(still.closedAt).toBeUndefined();
  });

  it("equity = balance + сумма unrealized PnL открытых позиций", () => {
    const position: Position = {
      id: "p1",
      assetId: asset.id,
      side: "long",
      entryPrice: 90,
      size: 10,
      leverage: 1,
      openedAt: 0,
      fees: 0,
      style: "day",
    };
    const state = makeState({
      account: makeAccount({ balance: 9100, positions: [position] }),
      prices: { [asset.id]: 100 },
    });
    const rng = mulberry32(5);
    const next = gameTick(1, state, rng);
    const p = next.account.positions[0];
    const price = next.prices[asset.id];
    const unrealized = p.closedAt ? 0 : (price - p.entryPrice) * p.size * p.leverage - p.fees;
    expect(next.account.equity).toBeCloseTo(next.account.balance + unrealized, 5);
  });

  // Регрессия: recalculateAccountMetrics суммировал unrealized PnL по ВСЕМ
  // позициям, включая уже закрытые — их entryPrice сравнивался с текущей
  // ценой на каждом тике вечно, и equity "плыла" в стороне от balance даже
  // без единой открытой позиции (поймано вручную в браузере: equity
  // продолжала тикать после закрытия последней позиции).
  it("после закрытия ВСЕХ позиций equity больше не отклоняется от balance на следующих тиках", () => {
    const closedPosition: Position = {
      id: "p1",
      assetId: asset.id,
      side: "long",
      entryPrice: 100,
      size: 10,
      leverage: 1,
      openedAt: 0,
      closedAt: 1, // real usage always uses Date.now() (never 0/falsy) — see comment above
      closePrice: 90,
      realizedPnl: -100,
      fees: 0,
      style: "day",
    };
    let state = makeState({
      account: makeAccount({ balance: 9900, positions: [closedPosition] }),
      prices: { [asset.id]: 90 },
    });
    const rng = mulberry32(6);
    for (let i = 0; i < 20; i++) {
      state = gameTick(1000, state, rng);
      expect(state.account.equity).toBe(state.account.balance);
    }
  });
});

// Упрощённая версия методологии раздела 25 (Monte Carlo): случайный
// day-трейдер, который открывает/закрывает позиции без стратегии, не должен
// разоряться подозрительно быстро — если разоряется за считанные сделки,
// комиссии/спред слишком высоки относительно волатильности актива.
describe("balance sanity (упрощённый Monte Carlo, раздел 25)", () => {
  it("случайный трейдер переживает разумное число тиков без немедленного банкротства", () => {
    const rng = mulberry32(123);
    let state = makeState({ account: makeAccount({ balance: 10000 }) });
    let bankruptAtTick: number | null = null;
    const TICKS = 500;
    for (let i = 0; i < TICKS; i++) {
      state = gameTick(1000, state, rng);
      if (state.account.equity <= 0) {
        bankruptAtTick = i;
        break;
      }
    }
    // Без открытых позиций баланс/equity вообще не должны падать — это
    // проверка именно на то, что сама симуляция цены не разоряет счёт
    // "просто так" (без сделок игрока).
    expect(bankruptAtTick).toBeNull();
    expect(state.account.equity).toBeCloseTo(10000, 5);
  });
});
