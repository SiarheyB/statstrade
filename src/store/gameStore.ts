"use client";

// Zustand-стор игры. Владеет GameState движка, гоняет тик, персистит через
// gameDb (Dexie/IndexedDB). UI подписывается на стор и НИКОГДА не вызывает
// формулы движка напрямую (raздел 17: «UI-компоненты никогда не вызывают
// формулы напрямую — только через публичные функции engine»).
import { create } from "zustand";
import assetsData from "@/data/assets.json";
import type { Account, Asset, PositionSide, SaveGame, TradingStyle } from "@/engine/entities/types";
import { NEUTRAL_REGIME } from "@/engine/entities/types";
import { TRADING_STYLE_CONFIGS } from "@/engine/entities/tradingStyleConfigs";
import { applyPositionClose, gameTick, type GameState } from "@/engine/gameLoop";
import { calculateRequiredMargin } from "@/engine/economy/marginEngine";
import { liveRng } from "@/engine/rng";
import { loadGame, saveGame } from "@/persistence/gameDb";

const ALL_ASSETS = assetsData as Asset[];

// Фаза 1: 6 тикеров-акций (спека — «5-10 тикеров»), 2 сектора для
// будущей наглядности корреляций в Фазе 3. Другие 65 активов уже лежат в
// assets.json, но не активны, пока не подключатся соответствующие фазы.
export const PHASE1_ASSET_IDS = ["STK_NEXTEK", "STK_QUANTA", "STK_PIXELON", "STK_IRONCORE", "STK_PETROVA", "STK_SOLARIS"];

// Фаза 2 (раздел 15): «Добавить Scalping и Swing режимы» — к day добавляются
// ещё два. Остальные 6 стилей раздела 5 (position/investing/algo/arbitrage/
// market_making/options) остаются вне UI до своих фаз (5-6) — данные для них
// уже в tradingStyleConfigs.ts, но выбрать их в игре пока нельзя.
export const SELECTABLE_STYLES: TradingStyle[] = ["scalping", "day", "swing"];

export const STARTING_BALANCE = 10_000;
// Стартовая цена всех Фазы-1 акций — спека не задаёт её явно (только
// баз. волатильность/снос), 100 — обычный дефолт для симуляторов такого рода.
const STARTING_PRICE = 100;
const TICK_INTERVAL_MS = 250; // ~4Hz — плавно на глаз, не грузит вкладку
const AUTOSAVE_INTERVAL_MS = 60_000; // раздел 12: «каждые 60 секунд реального времени»
const SAVE_VERSION = "1.0.0-phase1";

function freshAccount(): Account {
  return {
    id: "player",
    balance: STARTING_BALANCE,
    equity: STARTING_BALANCE,
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

function freshState(): GameState {
  const activeAssets = ALL_ASSETS.filter((a) => PHASE1_ASSET_IDS.includes(a.id));
  const prices: Record<string, number> = {};
  for (const a of activeAssets) prices[a.id] = STARTING_PRICE;
  return {
    account: freshAccount(),
    marketRegime: NEUTRAL_REGIME,
    prices,
    candles: {},
    activeAssets,
    activeStyle: TRADING_STYLE_CONFIGS.day,
    gameCalendarDay: 0,
    gameElapsedMs: 0,
  };
}

function stateToSave(state: GameState, onboardingDone: boolean, disclaimerSeen: boolean): SaveGame {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    account: state.account,
    marketRegime: state.marketRegime,
    prices: state.prices,
    candleHistory: state.candles,
    activeAssetIds: state.activeAssets.map((a) => a.id),
    activeTradingStyle: state.activeStyle.style,
    // Фаза 4 (лицензии/скиллы) введёт реальный checkUnlock — до тех пор все
    // стили Фазы 2 доступны сразу, разблокировок нет.
    unlockedStyles: SELECTABLE_STYLES,
    unlockedMarkets: ["stock"],
    gameCalendarDay: state.gameCalendarDay,
    gameElapsedMs: state.gameElapsedMs,
    onboardingDone,
    disclaimerSeen,
  };
}

function saveToState(save: SaveGame): GameState {
  // Устойчивость к смене набора активных активов между версиями (раздел 26
  // не требует этого явно, но save.version меняется — на будущее берём
  // текущий PHASE1_ASSET_IDS, а не список из старого сохранения).
  const activeAssets = ALL_ASSETS.filter((a) => PHASE1_ASSET_IDS.includes(a.id));
  const prices = { ...save.prices };
  for (const a of activeAssets) if (prices[a.id] == null) prices[a.id] = STARTING_PRICE;
  return {
    account: save.account,
    marketRegime: save.marketRegime,
    prices,
    candles: save.candleHistory,
    activeAssets,
    // Раньше жёстко бралось .day (баг: переключение стиля не переживало
    // перезагрузку) — восстанавливаем реально сохранённый стиль, с
    // фоллбэком на day для старых сохранений/повреждённого значения.
    activeStyle: TRADING_STYLE_CONFIGS[save.activeTradingStyle] ?? TRADING_STYLE_CONFIGS.day,
    gameCalendarDay: save.gameCalendarDay,
    // ?? 0 — только для сохранений, сделанных до появления этого поля;
    // новые всегда пишут реальное значение (см. stateToSave выше).
    gameElapsedMs: save.gameElapsedMs ?? 0,
  };
}

export type OpenPositionResult =
  | { ok: true }
  | { ok: false; error: "insufficient_funds" | "invalid_size" | "unknown_asset" | "invalid_leverage" };

interface GameStoreState {
  status: "loading" | "ready";
  game: GameState;
  onboardingDone: boolean;
  disclaimerSeen: boolean;
  init: () => Promise<void>;
  startTicking: () => void;
  stopTicking: () => void;
  openPosition: (input: {
    assetId: string;
    side: PositionSide;
    size: number;
    leverage?: number;
    stopLoss?: number;
    takeProfit?: number;
  }) => OpenPositionResult;
  closePosition: (positionId: string) => void;
  setStopLoss: (positionId: string, price: number | undefined) => void;
  setTakeProfit: (positionId: string, price: number | undefined) => void;
  setActiveStyle: (style: TradingStyle) => void;
  updateJournalEntry: (entryId: string, patch: { tags?: string[]; note?: string }) => void;
  completeOnboarding: () => void;
  acceptDisclaimer: () => void;
  persistNow: () => Promise<void>;
}

let tickHandle: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
let autosaveHandle: ReturnType<typeof setInterval> | null = null;

export const useGameStore = create<GameStoreState>((set, get) => ({
  status: "loading",
  game: freshState(),
  onboardingDone: false,
  disclaimerSeen: false,

  init: async () => {
    const save = await loadGame();
    if (save) {
      set({ game: saveToState(save), onboardingDone: save.onboardingDone, disclaimerSeen: save.disclaimerSeen, status: "ready" });
    } else {
      set({ game: freshState(), onboardingDone: false, disclaimerSeen: false, status: "ready" });
    }
  },

  startTicking: () => {
    if (tickHandle) return; // уже идёт — идемпотентно, как startScheduler()
    lastTickAt = performance.now();
    tickHandle = setInterval(() => {
      // Фоновая вкладка не тикает — тот же приём, что у orderflow/SyncProvider.
      if (typeof document !== "undefined" && document.hidden) {
        lastTickAt = performance.now();
        return;
      }
      const now = performance.now();
      const dtRealMs = now - lastTickAt;
      lastTickAt = now;
      set((s) => ({ game: gameTick(dtRealMs, s.game, liveRng()) }));
    }, TICK_INTERVAL_MS);

    if (!autosaveHandle) {
      autosaveHandle = setInterval(() => {
        void get().persistNow();
      }, AUTOSAVE_INTERVAL_MS);
    }
  },

  stopTicking: () => {
    if (tickHandle) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
    if (autosaveHandle) {
      clearInterval(autosaveHandle);
      autosaveHandle = null;
    }
  },

  openPosition: ({ assetId, side, size, leverage = 1, stopLoss, takeProfit }) => {
    const { game } = get();
    if (!(size > 0)) return { ok: false, error: "invalid_size" };
    if (!(leverage >= 1) || leverage > game.activeStyle.maxLeverage) return { ok: false, error: "invalid_leverage" };
    const asset = game.activeAssets.find((a) => a.id === assetId);
    const price = game.prices[assetId];
    if (!asset || price == null) return { ok: false, error: "unknown_asset" };
    // Резерв = requiredMargin (раздел 4.2) — при leverage=1 совпадает с
    // полным номиналом, как в Фазе 1. Раздел 26: сделка дороже доступного
    // баланса отклоняется, ордер не создаётся.
    const cost = calculateRequiredMargin(price, size, leverage);
    if (cost > game.account.balance) return { ok: false, error: "insufficient_funds" };

    const position = {
      id: crypto.randomUUID(),
      assetId,
      side,
      entryPrice: price,
      size,
      leverage,
      stopLoss,
      takeProfit,
      openedAt: Date.now(),
      fees: 0, // считается при закрытии — см. pnlCalculator.settleClose
      style: game.activeStyle.style,
    };
    set((s) => ({
      game: {
        ...s.game,
        account: {
          ...s.game.account,
          balance: s.game.account.balance - cost,
          positions: [...s.game.account.positions, position],
        },
      },
    }));
    return { ok: true };
  },

  closePosition: (positionId) => {
    const { game } = get();
    const position = game.account.positions.find((p) => p.id === positionId && !p.closedAt);
    if (!position) return;
    const price = game.prices[position.assetId];
    if (price == null) return;
    const account: Account = { ...game.account, positions: [...game.account.positions], journal: [...game.account.journal] };
    // Комиссия по стилю, под которым позиция была открыта — см. комментарий
    // у аналогичного места в gameLoop.ts (авто-закрытие по SL/TP/ликвидации).
    applyPositionClose(account, position, price, TRADING_STYLE_CONFIGS[position.style].commissionRate);
    set((s) => ({ game: { ...s.game, account } }));
  },

  setStopLoss: (positionId, price) => {
    set((s) => ({
      game: {
        ...s.game,
        account: {
          ...s.game.account,
          positions: s.game.account.positions.map((p) => (p.id === positionId ? { ...p, stopLoss: price } : p)),
        },
      },
    }));
  },

  setTakeProfit: (positionId, price) => {
    set((s) => ({
      game: {
        ...s.game,
        account: {
          ...s.game.account,
          positions: s.game.account.positions.map((p) => (p.id === positionId ? { ...p, takeProfit: price } : p)),
        },
      },
    }));
  },

  setActiveStyle: (style) => {
    const config = TRADING_STYLE_CONFIGS[style];
    if (!config) return;
    // Меняет timeAcceleration (и видимую скорость графика) со следующего
    // тика — критерий приёмки Фазы 2 (раздел 16). Открытые позиции/баланс
    // не трогает: смена стиля влияет только на будущие тики и новые ордера.
    set((s) => ({ game: { ...s.game, activeStyle: config } }));
    void get().persistNow();
  },

  updateJournalEntry: (entryId, patch) => {
    set((s) => ({
      game: {
        ...s.game,
        account: {
          ...s.game.account,
          journal: s.game.account.journal.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
        },
      },
    }));
    void get().persistNow();
  },

  completeOnboarding: () => {
    set({ onboardingDone: true });
    void get().persistNow();
  },

  acceptDisclaimer: () => {
    set({ disclaimerSeen: true });
    void get().persistNow();
  },

  persistNow: async () => {
    const { game, onboardingDone, disclaimerSeen } = get();
    await saveGame(stateToSave(game, onboardingDone, disclaimerSeen));
  },
}));
