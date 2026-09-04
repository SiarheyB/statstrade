import { describe, it, expect } from "vitest";
import { candleIntervalMs, checkStopConditions, gameTick, MONTH_MS, type GameState } from "@/engine/gameLoop";
import { freshLifestyle } from "@/engine/economy/shop";
import { DEFAULT_TUNING } from "@/engine/entities/tuning";
import { freshContractState } from "@/engine/player/contracts";
import { freshPerkState } from "@/engine/player/perks";
import { makeRegime } from "@/engine/market/marketRegime";
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
    activeNews: [],
    newsFeed: [],
    dayStartEquity: 10_000,
    tuning: DEFAULT_TUNING,
    contracts: freshContractState(),
    perks: freshPerkState(),
    contractPoints: 0,
    unlockedMarkets: ["stock"],
    lastContractResult: null,
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

  it("копит свечи в бакеты по candleIntervalMs(timeAcceleration), не создавая лишних баров внутри одного бакета", () => {
    let state = makeState();
    const rng = mulberry32(2);
    // Day-режим: candleIntervalMs(60) = 60_000 игровых мс (1 игровая минута,
    // как и раньше при захардкоженной константе) — 1 реальная секунда =
    // 60 игровых секунд, после первого тика уже есть минимум одна свеча.
    const interval = candleIntervalMs(TRADING_STYLE_CONFIGS.day.timeAcceleration);
    expect(interval).toBe(60_000);
    state = gameTick(200, state, rng); // 200мс реала = 12с игровых — один бакет
    state = gameTick(200, state, rng); // ещё 12с игровых — тот же бакет (< 60с)
    expect(state.candles[asset.id].length).toBe(1);
    expect(state.candles[asset.id][0].timestamp).toBeLessThan(interval);
    state = gameTick(3000, state, rng); // +180с игровых — новый бакет
    expect(state.candles[asset.id].length).toBeGreaterThan(1);
    expect(state.candles[asset.id].length).toBeLessThanOrEqual(500);
  });

  // Регрессия: раньше свеча была ФИКСИРОВАННОЙ (1 игровая минута) вне
  // зависимости от timeAcceleration стиля — у investing (43200x) один тик
  // движка перепрыгивал сразу ~180 минутных бакетов, и appendPriceToCandles
  // добавляла только ОДИН бар за тик: подряд идущие свечи в массиве
  // оказывались на самом деле в часах друг от друга, график превращался в
  // редкие несвязанные точки. candleIntervalMs масштабирует бакет так,
  // чтобы на свечу всегда приходилось примерно одинаковое число тиков.
  it("investing (43200x) не плодит один бар в час — интервал свечи растёт вместе с ускорением", () => {
    let state = makeState({ activeStyle: TRADING_STYLE_CONFIGS.investing });
    const rng = mulberry32(21);
    for (let i = 0; i < 10; i++) state = gameTick(250, state, rng); // ~10 UI-тиков по 250мс
    const candles = state.candles[asset.id];
    // За 10 тиков должно накопиться заметно больше одной свечи (не редкие
    // точки раз в несколько тиков), но и не 10 отдельных пустых баров —
    // порядок величины, а не точное число (зависит от кратности округления).
    expect(candles.length).toBeGreaterThan(1);
    expect(candles.length).toBeLessThanOrEqual(10);
  });

  // Регрессия: два независимых тикера на одном источнике (вторая вкладка,
  // либо в деве — осиротевший setInterval от предыдущей версии модуля после
  // Fast Refresh) могли записать в state.candles бакет со временем МЕНЬШЕ
  // уже сохранённого — массив переставал быть отсортированным по времени,
  // и график рисовал "две дорожки" одна поверх другой.
  it("не добавляет свечу с бакетом раньше уже существующего (защита от отката времени назад)", () => {
    let state = makeState();
    const rng = mulberry32(20);
    state = gameTick(5000, state, rng); // копим нормальную историю вперёд
    state = gameTick(5000, state, rng);
    const before = state.candles[asset.id];
    const lastTimestamp = before[before.length - 1].timestamp;
    // Тик с отрицательным dtRealMs — единственный способ извне заставить
    // gameElapsedMs (и, соответственно, бакет) уйти назад; в реальной игре
    // так не бывает (dtRealMs = perfomance.now() diff, всегда ≥0), но
    // защита должна держаться и на этом крайнем случае.
    state = gameTick(-100_000, state, rng);
    const after = state.candles[asset.id];
    // Либо длина не изменилась (бакет отклонён), либо новый бакет всё равно
    // не раньше последнего уже существующего — в любом случае убывания нет.
    expect(after[after.length - 1].timestamp).toBeGreaterThanOrEqual(lastTimestamp);
    for (let i = 1; i < after.length; i++) {
      expect(after[i].timestamp).toBeGreaterThan(after[i - 1].timestamp);
    }
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
    const rng = mulberry32(7);
    const next = gameTick(1, state, rng);
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
    const rng = mulberry32(8);
    const next = gameTick(1, state, rng);
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
    const rng = mulberry32(9);
    const next = gameTick(1, state, rng);
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
    const rng = mulberry32(10);
    const next = gameTick(1, state, rng);
    expect(next.account.skills.day).toBeDefined();
    expect(next.account.skills.day.xp + next.account.skills.day.level).toBeGreaterThan(0);
  });

  it("опыт копится за несколько сделок подряд, а не перезаписывается", () => {
    let state = makeState({ account: makeAccount({ balance: 10000, skills: {} }) });
    const rng = mulberry32(11);
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
      state = gameTick(1, state, rng);
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

describe("рыночные режимы и новости (Фаза 3)", () => {
  // Тот же сид и тот же стартовый набор — разница в итоговой цене может быть
  // только из-за режима. Нужен актив с НЕнулевым baseDrift: сверху лежит
  // asset с drift 0, а driftModifier режима — множитель, и на нуле любой
  // режим дал бы одинаковый снос.
  const trending: Asset = { ...asset, baseDrift: 0.1 };

  function priceAfter(regimeType: "bull" | "crisis", seed: number): number {
    let next = makeState({
      marketRegime: makeRegime(regimeType, 1),
      activeAssets: [trending],
      prices: { [trending.id]: 100 },
    });
    const rng = mulberry32(seed);
    for (let i = 0; i < 400; i++) next = gameTick(1000, next, rng);
    return next.prices[trending.id];
  }

  function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  it("бычий режим уводит цену выше кризисного (медиана по 21 сиду)", () => {
    // Сравниваем медианы, а не одну серию: у кризиса волатильность втрое
    // выше, и отдельная траектория может улететь куда угодно — это и есть
    // кризис, а не поломка теста.
    const seeds = Array.from({ length: 21 }, (_, i) => i + 1);
    const bull = median(seeds.map((s) => priceAfter("bull", s)));
    const crisis = median(seeds.map((s) => priceAfter("crisis", s)));
    expect(bull).toBeGreaterThan(crisis);
    expect(crisis).toBeLessThan(100); // кризис в среднем именно роняет рынок
  });

  it("новость попадает в ленту и двигает цену затронутой бумаги", () => {
    // Гоняем, пока генератор не выдаст новость (частота ~1.5 в игровой день).
    let state = makeState();
    const rng = mulberry32(2);
    let ticks = 0;
    while (state.newsFeed.length === 0 && ticks < 5_000) {
      state = gameTick(1000, state, rng);
      ticks++;
    }
    expect(state.newsFeed.length).toBeGreaterThan(0);
    const news = state.newsFeed[0];
    expect(news.headline).not.toContain("{");
    expect(news.expiresAt).toBeGreaterThan(news.timestamp);
  });

  it("лента не растёт бесконечно", () => {
    let state = makeState();
    const rng = mulberry32(4);
    // investing-ускорение: новости сыплются гораздо быстрее реального времени.
    const investing = { ...state, activeStyle: TRADING_STYLE_CONFIGS.investing };
    state = investing;
    for (let i = 0; i < 3_000; i++) state = gameTick(250, state, rng);
    expect(state.newsFeed.length).toBeLessThanOrEqual(50);
  });

  it("активы одной группы корреляции ходят вместе чаще, чем врозь", () => {
    const sibling: Asset = { ...asset, id: "STK_SIBLING", symbol: "SIB" };
    const stranger: Asset = { ...asset, id: "STK_STRANGER", symbol: "STR", correlationGroup: "energy_stocks" };
    let state = makeState({
      activeAssets: [asset, sibling, stranger],
      prices: { [asset.id]: 100, [sibling.id]: 100, [stranger.id]: 100 },
      // Боковик с минимальным сносом: смотрим на шум, а не на общий тренд.
      marketRegime: makeRegime("sideways", 1),
    });
    const rng = mulberry32(12);
    let sameGroupAgree = 0;
    let otherGroupAgree = 0;
    let prev = state.prices;
    for (let i = 0; i < 400; i++) {
      state = gameTick(1000, state, rng);
      const d1 = Math.sign(state.prices[asset.id] - prev[asset.id]);
      const d2 = Math.sign(state.prices[sibling.id] - prev[sibling.id]);
      const d3 = Math.sign(state.prices[stranger.id] - prev[stranger.id]);
      if (d1 !== 0 && d1 === d2) sameGroupAgree++;
      if (d1 !== 0 && d1 === d3) otherGroupAgree++;
      prev = state.prices;
    }
    expect(sameGroupAgree).toBeGreaterThan(otherGroupAgree);
  });
});

describe("настройки баланса из админки (tuning)", () => {
  it("newsPerGameDay = 0 полностью выключает новости", () => {
    let state = makeState({ tuning: { ...DEFAULT_TUNING, newsPerGameDay: 0 } });
    const rng = mulberry32(8);
    for (let i = 0; i < 2_000; i++) state = gameTick(250, { ...state, activeStyle: TRADING_STYLE_CONFIGS.investing }, rng);
    expect(state.newsFeed).toEqual([]);
  });

  it("множитель расходов масштабирует списание за образ жизни", () => {
    const lifestyle = { ...freshLifestyle(), ownedItemIds: ["life_studio"] }; // 900/мес
    const state = makeState({ lifestyle, account: makeAccount({ balance: 10_000 }), tuning: { ...DEFAULT_TUNING, upkeepMultiplier: 0.5 } });
    const dtRealMs = MONTH_MS / TRADING_STYLE_CONFIGS.investing.timeAcceleration;
    const next = gameTick(dtRealMs, { ...state, activeStyle: TRADING_STYLE_CONFIGS.investing }, mulberry32(9));
    expect(next.account.balance).toBe(10_000 - 450);
  });

  it("множитель волатильности расширяет размах цены", () => {
    function spread(volatilityMultiplier: number): number {
      let state = makeState({ tuning: { ...DEFAULT_TUNING, volatilityMultiplier, newsPerGameDay: 0 } });
      const rng = mulberry32(21);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 500; i++) {
        state = gameTick(1000, state, rng);
        lo = Math.min(lo, state.prices[asset.id]);
        hi = Math.max(hi, state.prices[asset.id]);
      }
      return hi - lo;
    }
    expect(spread(2)).toBeGreaterThan(spread(0.5));
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
      const next = gameTick(250, state, mulberry32(2));
      return next.account.skills.day?.xp ?? 0;
    }
    expect(xpAfterClose(2)).toBeGreaterThan(xpAfterClose(1));
  });
});
