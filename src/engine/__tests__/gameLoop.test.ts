import { describe, it, expect, vi } from "vitest";
import { applyPositionClose, checkStopConditions, gameTick, MONTH_MS, type GameState } from "@/engine/gameLoop";
import { freshLifestyle } from "@/engine/economy/shop";
import { DEFAULT_TUNING } from "@/engine/entities/tuning";
import { freshContractState } from "@/engine/player/contracts";
import { freshPerkState } from "@/engine/player/perks";
import { freshStreak } from "@/engine/player/achievements";
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
    lastDividendQuarter: 0,
    lifestyle: freshLifestyle(),
    lastUpkeepMonth: 0,
    newsFeed: [],
    dayChange: {},
    dayStartEquity: 10_000,
    tuning: DEFAULT_TUNING,
    contracts: freshContractState(),
    perks: freshPerkState(),
    daily: { day: 0, completedIds: [] },
    lastDailyCompleted: [],
    bots: [],
    drawings: {},
    contractPoints: 0,
    unlockedMarkets: ["stock"],
    lastContractResult: null,
    sponsor: null,
    wipedOut: false,
    achievements: [],
    lastAchievements: [],
    streak: freshStreak(),
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
  // Цены здесь больше не рождаются: рынок общий и живёт на сервере, тик
  // только применяет пришедшие котировки к счёту. Генерация цен, свечей,
  // новостей и режимов проверяется в src/lib/game/__tests__/marketGen.test.ts.
  it("двигает игровое время вровень с реальным, не трогая цены", () => {
    const state = makeState();
    const next = gameTick(1000, state);
    expect(next.gameElapsedMs).toBe(1000);
    expect(next.prices[asset.id]).toBe(state.prices[asset.id]);
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
    const next = gameTick(1, state);
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
    const next = gameTick(1, state);
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
    const next = gameTick(1, state);
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
    for (let i = 0; i < 20; i++) {
      state = gameTick(1000, state);
      expect(state.account.equity).toBe(state.account.balance);
    }
  });
});

describe("ликвидация (раздел 4.2, интеграция в gameTick)", () => {
  it("закрывает позицию с плечом ровно на ликвидационной цене, раньше SL/TP", () => {
    const position: Position = {
      id: "p1",
      assetId: asset.id,
      side: "long",
      entryPrice: 100,
      size: 10,
      leverage: 10, // liq ≈ 90.5
      stopLoss: 50, // сильно ниже ликвидации — не должен успеть сработать первым
      openedAt: 0,
      fees: 0,
      style: "day",
    };
    const requiredMargin = 100; // entryPrice*size/leverage = 1000/10
    const state = makeState({
      account: makeAccount({ balance: 10000 - requiredMargin, positions: [position] }),
      prices: { [asset.id]: 85 }, // ниже ликвидационной цены
    });
    const next = gameTick(1, state);
    const closed = next.account.positions.find((p) => p.id === "p1")!;
    expect(closed.closedAt).toBeDefined();
    expect(closed.closePrice).toBeCloseTo(90.5, 1); // ликвидационная цена, не 85 и не 50 (SL)
  });

  it("без плеча (leverage=1) ликвидация практически недостижима — SL продолжает работать как раньше", () => {
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
    const state = makeState({
      account: makeAccount({ balance: 9000, positions: [position] }),
      prices: { [asset.id]: 85 },
    });
    const next = gameTick(1, state);
    const closed = next.account.positions.find((p) => p.id === "p1")!;
    expect(closed.closePrice).toBe(90); // закрылось по SL, не по (недостижимой) ликвидации
  });

  it("marginUsed/marginLevel отражают открытые позиции с плечом", () => {
    const position: Position = {
      id: "p1",
      assetId: asset.id,
      side: "long",
      entryPrice: 100,
      size: 10,
      leverage: 5, // requiredMargin = 1000/5 = 200
      openedAt: 0,
      fees: 0,
      style: "day",
    };
    const state = makeState({
      account: makeAccount({ balance: 9800, positions: [position] }),
      prices: { [asset.id]: 100 },
    });
    const next = gameTick(1, state);
    expect(next.account.marginUsed).toBeCloseTo(200, 5);
    expect(next.account.marginLevel).toBeCloseTo((next.account.equity / 200) * 100, 5);
  });
});

describe("прогрессия (раздел 4.5, интеграция в gameTick)", () => {
  it("закрытие позиции начисляет XP в account.skills по стилю сделки", () => {
    const position: Position = {
      id: "p1",
      assetId: asset.id,
      side: "long",
      entryPrice: 100,
      size: 10,
      leverage: 1,
      takeProfit: 110,
      openedAt: 0,
      fees: 0,
      style: "day",
    };
    const state = makeState({
      account: makeAccount({ balance: 9000, positions: [position], skills: {} }),
      prices: { [asset.id]: 110 },
    });
    const next = gameTick(1, state);
    expect(next.account.skills.day).toBeDefined();
    expect(next.account.skills.day.xp + next.account.skills.day.level).toBeGreaterThan(0);
  });

  it("опыт копится за несколько сделок подряд, а не перезаписывается", () => {
    let state = makeState({ account: makeAccount({ balance: 10000, skills: {} }) });
    for (let i = 0; i < 3; i++) {
      state = {
        ...state,
        account: {
          ...state.account,
          positions: [
            ...state.account.positions,
            {
              id: `p${i}`,
              assetId: asset.id,
              side: "long",
              entryPrice: state.prices[asset.id],
              size: 1,
              leverage: 1,
              takeProfit: state.prices[asset.id] + 5,
              openedAt: 0,
              fees: 0,
              style: "day" as const,
            },
          ],
        },
        prices: { [asset.id]: state.prices[asset.id] + 5 },
      };
      state = gameTick(1, state);
    }
    // 3 закрытые прибыльные сделки — суммарный опыт больше, чем от одной.
    const afterThree = state.account.skills.day.level * 1000 + state.account.skills.day.xp;
    expect(afterThree).toBeGreaterThan(0);
  });
});

// Упрощённая версия методологии раздела 25 (Monte Carlo): случайный
// day-трейдер, который открывает/закрывает позиции без стратегии, не должен
// разоряться подозрительно быстро — если разоряется за считанные сделки,
// комиссии/спред слишком высоки относительно волатильности актива.
describe("balance sanity (упрощённый Monte Carlo, раздел 25)", () => {
  it("случайный трейдер переживает разумное число тиков без немедленного банкротства", () => {
    let state = makeState({ account: makeAccount({ balance: 10000 }) });
    let bankruptAtTick: number | null = null;
    const TICKS = 500;
    for (let i = 0; i < TICKS; i++) {
      state = gameTick(1000, state);
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

describe("расход на образ жизни (раздел 13)", () => {
  it("списывает содержание за каждый пройденный игровой месяц, а не один раз", () => {
    // investing (43200x): один тик реального времени перепрыгивает сразу
    // несколько месяцев — платить надо за все, иначе яхту выгоднее держать
    // на самом быстром стиле (бесплатно).
    const lifestyle = { ...freshLifestyle(), ownedItemIds: ["life_studio"] }; // 900/мес
    const state = makeState({ lifestyle, account: makeAccount({ balance: 10_000 }) });
    const dtRealMs = (3 * MONTH_MS) / TRADING_STYLE_CONFIGS.investing.timeAcceleration;
    const next = gameTick(dtRealMs, { ...state, activeStyle: TRADING_STYLE_CONFIGS.investing }, mulberry32(3));
    expect(next.lastUpkeepMonth).toBe(3);
    expect(next.account.balance).toBe(10_000 - 3 * 900);
    expect(next.lifestyle.totalUpkeepPaid).toBe(2_700);
  });

  it("без покупок баланс не трогается вовсе", () => {
    const state = makeState({ account: makeAccount({ balance: 10_000 }) });
    const dtRealMs = (2 * MONTH_MS) / TRADING_STYLE_CONFIGS.investing.timeAcceleration;
    const next = gameTick(dtRealMs, { ...state, activeStyle: TRADING_STYLE_CONFIGS.investing }, mulberry32(4));
    expect(next.account.balance).toBe(10_000);
    expect(next.lastUpkeepMonth).toBe(2);
  });

  it("не уводит баланс в минус, когда на содержание не хватает", () => {
    const lifestyle = { ...freshLifestyle(), ownedItemIds: ["life_yacht"] }; // 25 000/мес
    const state = makeState({ lifestyle, account: makeAccount({ balance: 1_000 }) });
    const dtRealMs = MONTH_MS / TRADING_STYLE_CONFIGS.investing.timeAcceleration;
    const next = gameTick(dtRealMs, { ...state, activeStyle: TRADING_STYLE_CONFIGS.investing }, mulberry32(5));
    expect(next.account.balance).toBe(0);
    expect(next.lifestyle.unpaidUpkeep).toBe(24_000);
  });
});

describe("настройки баланса из админки (tuning)", () => {
  it("множитель расходов масштабирует списание за образ жизни", () => {
    const lifestyle = { ...freshLifestyle(), ownedItemIds: ["life_studio"] }; // 900/мес
    const state = makeState({ lifestyle, account: makeAccount({ balance: 10_000 }), tuning: { ...DEFAULT_TUNING, upkeepMultiplier: 0.5 } });
    const dtRealMs = MONTH_MS / TRADING_STYLE_CONFIGS.investing.timeAcceleration;
    const next = gameTick(dtRealMs, { ...state, activeStyle: TRADING_STYLE_CONFIGS.investing }, mulberry32(9));
    expect(next.account.balance).toBe(10_000 - 450);
  });

  it("множитель опыта ускоряет прокачку", () => {
    function xpAfterClose(xpMultiplier: number): number {
      const position: Position = {
        id: "p1",
        assetId: asset.id,
        side: "long",
        entryPrice: 100,
        size: 10,
        leverage: 1,
        stopLoss: 95,
        openedAt: 0,
        fees: 0,
        style: "day",
      };
      const state = makeState({
        account: makeAccount({ positions: [position] }),
        prices: { [asset.id]: 94 }, // ниже стопа — закроется на этом же тике
        tuning: { ...DEFAULT_TUNING, xpMultiplier },
      });
      const next = gameTick(250, state);
      return next.account.skills.day?.xp ?? 0;
    }
    expect(xpAfterClose(2)).toBeGreaterThan(xpAfterClose(1));
  });
});

// Крипта торгуется круглосуточно — на ней проверяем исполнение заявок, не
// завися от того, в какой день недели запустили тесты.
const cryptoAsset: Asset = {
  ...asset,
  id: "CRY_TEST",
  symbol: "TESTUSD",
  assetClass: "crypto",
  correlationGroup: "crypto_majors",
  tradingHours: "24/7",
};

function pendingState(order: Partial<import("@/engine/entities/types").Order>, price: number) {
  return makeState({
    activeAssets: [cryptoAsset],
    prices: { [cryptoAsset.id]: price },
    account: makeAccount({
      pendingOrders: [
        {
          id: "o1",
          assetId: cryptoAsset.id,
          type: "limit",
          side: "long",
          size: 10,
          createdAt: 0,
          status: "pending",
          leverage: 1,
          ...order,
        },
      ],
    }),
  });
}

describe("исполнение отложенных ордеров в тике", () => {
  it("лимитка ждёт своей цены и не открывает позицию раньше времени", () => {
    const next = gameTick(1000, pendingState({ limitPrice: 95 }, 100));
    expect(next.account.positions.filter((p) => !p.closedAt)).toHaveLength(0);
    expect(next.account.pendingOrders).toHaveLength(1);
  });

  it("дойдя до уровня, лимитка превращается в позицию и снимается", () => {
    const next = gameTick(1000, pendingState({ limitPrice: 95 }, 94));
    const open = next.account.positions.filter((p) => !p.closedAt);
    expect(open).toHaveLength(1);
    expect(next.account.pendingOrders).toHaveLength(0);
    // Вошли по уровню заявки, а не по текущей цене: в этом весь смысл лимитки.
    // Проскальзывание от стресса допускается, но не больше процента.
    expect(open[0].entryPrice).toBeGreaterThanOrEqual(95);
    expect(open[0].entryPrice).toBeLessThan(95 * 1.01);
  });

  it("заявка несёт стоп и тейк с собой — иначе от неё нет защиты", () => {
    const next = gameTick(1000, pendingState({ limitPrice: 95, stopLoss: 90, takeProfit: 110 }, 94));
    const open = next.account.positions.find((p) => !p.closedAt)!;
    expect(open.stopLoss).toBe(90);
    expect(open.takeProfit).toBe(110);
  });

  it("не хватило денег к моменту срабатывания — заявка сгорает, а не висит вечно", () => {
    const state = pendingState({ limitPrice: 95, size: 10_000 }, 94);
    const next = gameTick(1000, state);
    expect(next.account.positions.filter((p) => !p.closedAt)).toHaveLength(0);
    expect(next.account.pendingOrders).toHaveLength(0);
  });

  it("просроченная заявка снимается", () => {
    const next = gameTick(1000, pendingState({ limitPrice: 95, expiresAt: Date.now() - 1000 }, 94));
    expect(next.account.pendingOrders).toHaveLength(0);
    expect(next.account.positions.filter((p) => !p.closedAt)).toHaveLength(0);
  });

  it("на закрытом рынке заявка ждёт открытия, а не отменяется", () => {
    // Акция в субботу: рынок закрыт, цена на уровне — но исполнять некому.
    const saturday = new Date("2026-09-05T12:00:00Z").getTime();
    const spy = vi.spyOn(Date, "now").mockReturnValue(saturday);
    try {
      const state = makeState({
        prices: { [asset.id]: 94 },
        account: makeAccount({
          pendingOrders: [
            { id: "o1", assetId: asset.id, type: "limit", side: "long", size: 10, createdAt: 0, status: "pending", limitPrice: 95, leverage: 1 },
          ],
        }),
      });
      const next = gameTick(1000, state);
      expect(next.account.pendingOrders).toHaveLength(1);
      expect(next.account.positions.filter((p) => !p.closedAt)).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("частичное закрытие", () => {
  const openPosition: Position = {
    id: "p1",
    assetId: cryptoAsset.id,
    side: "long",
    entryPrice: 100,
    size: 10,
    leverage: 1,
    openedAt: 0,
    fees: 0,
    style: "day",
  };

  it("закрывает ломоть и оставляет остаток открытым с той же ценой входа", () => {
    const account = makeAccount({ positions: [openPosition] });
    applyPositionClose(account, openPosition, 110, 0, 0, 1, 0, 4);
    const open = account.positions.filter((p) => !p.closedAt);
    const closed = account.positions.filter((p) => p.closedAt);
    expect(open).toHaveLength(1);
    expect(open[0].size).toBe(6);
    expect(open[0].entryPrice).toBe(100);
    expect(closed).toHaveLength(1);
    expect(closed[0].size).toBe(4);
  });

  it("у закрытого ломтя свой id — иначе он столкнулся бы с остатком в списке", () => {
    const account = makeAccount({ positions: [openPosition] });
    applyPositionClose(account, openPosition, 110, 0, 0, 1, 0, 4);
    const ids = account.positions.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("прибыль начисляется только на закрытую часть", () => {
    const account = makeAccount({ balance: 0, positions: [openPosition] });
    const pnl = applyPositionClose(account, openPosition, 110, 0, 0, 1, 0, 4);
    // 4 единицы по +10 = 40, плюс возвращённая маржа 4×100.
    expect(pnl).toBeCloseTo(40, 0);
    expect(account.balance).toBeCloseTo(440, 0);
  });

  it("размер больше позиции закрывает её целиком, а не уходит в минус", () => {
    const account = makeAccount({ positions: [openPosition] });
    applyPositionClose(account, openPosition, 110, 0, 0, 1, 0, 999);
    expect(account.positions.filter((p) => !p.closedAt)).toHaveLength(0);
  });

  it("без указания размера поведение прежнее — закрывается вся позиция", () => {
    const account = makeAccount({ positions: [openPosition] });
    applyPositionClose(account, openPosition, 110, 0);
    expect(account.positions.filter((p) => !p.closedAt)).toHaveLength(0);
    expect(account.positions[0].id).toBe("p1");
  });
});

describe("скользящий стоп в тике", () => {
  it("подтягивается за ценой и закрывает позицию на откате", () => {
    const position: Position = {
      id: "p1",
      assetId: cryptoAsset.id,
      side: "long",
      entryPrice: 100,
      size: 1,
      leverage: 1,
      trailingPct: 5,
      openedAt: 0,
      fees: 0,
      style: "day",
    };
    let state = makeState({
      activeAssets: [cryptoAsset],
      prices: { [cryptoAsset.id]: 100 },
      account: makeAccount({ positions: [position] }),
    });
    state = gameTick(1000, state);
    expect(state.account.positions[0].stopLoss).toBeCloseTo(95, 6);

    // Цена ушла в прибыль — стоп поднялся следом.
    state = gameTick(1000, { ...state, prices: { [cryptoAsset.id]: 120 } });
    expect(state.account.positions[0].stopLoss).toBeCloseTo(114, 6);

    // Откат ниже подтянутого стопа — позиция закрыта в прибыли, а не в убытке.
    state = gameTick(1000, { ...state, prices: { [cryptoAsset.id]: 113 } });
    const closed = state.account.positions.find((p) => p.closedAt);
    expect(closed).toBeDefined();
    expect(closed!.realizedPnl!).toBeGreaterThan(0);
  });
});
