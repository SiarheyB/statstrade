"use client";

// Zustand-стор игры. Владеет GameState движка, гоняет тик, персистит через
// gameDb (Dexie/IndexedDB). UI подписывается на стор и НИКОГДА не вызывает
// формулы движка напрямую (raздел 17: «UI-компоненты никогда не вызывают
// формулы напрямую — только через публичные функции engine»).
import { create } from "zustand";
import assetsData from "@/data/assets.json";
import type {
  Account,
  Asset,
  AssetClass,
  Candle,
  GameDrawing,
  MarketRegime,
  NewsEvent,
  Order,
  PositionSide,
  SaveGame,
  TradingStyle,
} from "@/engine/entities/types";
import { validateOrder } from "@/engine/player/pendingOrders";
import { sponsorOffer, WIPEOUT_PRESTIGE_PENALTY } from "@/engine/player/bailout";
import { freshStreak, streakReward, touchStreak } from "@/engine/player/achievements";
import { freshTaxState } from "@/engine/economy/taxes";
import { botRecord } from "@/engine/player/algoBots";
import { makeRegime } from "@/engine/market/marketRegime";
import { TRADING_STYLE_CONFIGS } from "@/engine/entities/tradingStyleConfigs";
import { applyPositionClose, applyPositionOpen, gameTick, MONTH_MS, type GameState } from "@/engine/gameLoop";
import { DEFAULT_TUNING, type GameTuning } from "@/engine/entities/tuning";
import {
  abandonContract,
  CONTRACTS,
  freshContractState,
  startContract,
  type StartError,
} from "@/engine/player/contracts";
import { availablePoints, freshPerkState, perkEffects, unlockPerk, type PerkError } from "@/engine/player/perks";
import { freshDailyState } from "@/engine/player/dailyTasks";
import { catchUp, type OfflineReport } from "@/engine/offline";
import { botSlots, defaultBot, type AlgoBot } from "@/engine/player/algoBots";
import { applyPurchase, canPurchase, equipTheme, freshLifestyle, getShopItem, type PurchaseError } from "@/engine/economy/shop";
import { calculateRequiredMargin } from "@/engine/economy/marginEngine";
import { deleteSave, loadGame, saveGame } from "@/persistence/gameDb";
import {
  fetchCandles,
  fetchQuotes,
  funds as fundsApi,
  loans as loansApi,
  strategies as strategiesApi,
  syncSnapshot,
} from "@/lib/game/worldClient";
import { traderRankKey } from "@/engine/economy/shop";

const ALL_ASSETS = assetsData as Asset[];

// Фаза 1: 6 тикеров-акций (спека — «5-10 тикеров»), 2 сектора для
// будущей наглядности корреляций в Фазе 3. Другие 65 активов уже лежат в
// assets.json, но не активны, пока не подключатся соответствующие фазы.
export const PHASE1_ASSET_IDS = ["STK_NEXTEK", "STK_QUANTA", "STK_PIXELON", "STK_IRONCORE", "STK_PETROVA", "STK_SOLARIS"];

// Фаза 2 (раздел 15): «Добавить Scalping и Swing режимы» — к day добавляются
// ещё два. Фаза 5 добавляет Investing (buy&hold, дивиденды) отдельной веткой
// — раздел 8: «доступен с самого начала как альтернативная ветка», без
// условий разблокировки. Остальные стили раздела 5 (position/algo/
// arbitrage/market_making/options) остаются вне UI до своих фаз (6) — данные
// для них уже в tradingStyleConfigs.ts, но выбрать их в игре пока нельзя.
export const SELECTABLE_STYLES: TradingStyle[] = ["scalping", "day", "swing", "investing"];

// Investing — buy&hold с дивидендами (раздел 4.6): полный список акций и
// облигаций из assets.json (те, у кого есть dividendYield), а не 6 тикеров
// Фазы 1 — диверсификация по секторам ЕСТЬ смысл, только когда есть из чего
// выбирать. Форекс/крипта/товары/индексы намеренно не включены — они без
// dividendYield (нечего "держать ради купона"), их время — Фаза 3/6.
export const INVESTING_ASSET_IDS = ALL_ASSETS.filter((a) => a.assetClass === "stock" || a.assetClass === "bond").map(
  (a) => a.id,
);

function assetIdsForStyle(style: TradingStyle): string[] {
  return style === "investing" ? INVESTING_ASSET_IDS : PHASE1_ASSET_IDS;
}

/**
 * Инструменты открытых рынков. Акции доступны с начала, остальные классы
 * (крипта, форекс, товары, индексы) приходят наградой за контракты — это и
 * есть ощутимая награда за прогресс, а не «плюс десять процентов к чему-то».
 */
export function assetIdsForMarkets(markets: AssetClass[]): string[] {
  return ALL_ASSETS.filter((a) => markets.includes(a.assetClass) && a.assetClass !== "stock").map((a) => a.id);
}

// Стартовый баланс по умолчанию. Реальное значение приходит из настроек
// админки (tuning.startingBalance) — эта константа остаётся дефолтом движка
// и точкой отсчёта для метрик портфеля в старых сохранениях.
export const STARTING_BALANCE = DEFAULT_TUNING.startingBalance;
// Цена до первого ответа сервера — та, с которой инструмент начинал историю.
// Настоящая придёт с котировками через пару секунд; показывать всё это время
// «100» у золота и биткоина было бы обманом.
function seedPrice(asset: Asset): number {
  return asset.startPrice ?? 100;
}
const TICK_INTERVAL_MS = 250; // ~4Hz — плавно на глаз, не грузит вкладку
const AUTOSAVE_INTERVAL_MS = 60_000; // раздел 12: «каждые 60 секунд реального времени»
// Синхронизация с общим миром — раз в минуту, тем же ритмом, что автосейв:
// чаще незачем (в рейтинге сравниваются достижения, а не секунды), реже —
// и другие игроки видели бы устаревший профиль.
const WORLD_SYNC_INTERVAL_MS = 60_000;
// Как часто спрашиваем котировки общего рынка. Четыре секунды — компромисс:
// цена меняется каждую минуту (свеча минутная), но внутри минуты она тоже
// живая, и раз в четыре секунды график шевелится достаточно, чтобы терминал
// не выглядел замершим, а сервер не считает лишнего.
const QUOTES_INTERVAL_MS = 4_000;
// Свечи для алго-ботов: им нужна история своего инструмента, чтобы считать
// сигнал. Раз в минуту — чаще незачем, бар всё равно минутный.
const BOT_CANDLES_INTERVAL_MS = 60_000;
const BOT_CANDLES_LIMIT = 80;
const SAVE_VERSION = "1.0.0-phase1";

function freshAccount(startingBalance = STARTING_BALANCE): Account {
  return {
    id: "player",
    balance: startingBalance,
    equity: startingBalance,
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

function freshState(tuning: GameTuning = DEFAULT_TUNING): GameState {
  const activeAssets = ALL_ASSETS.filter((a) => PHASE1_ASSET_IDS.includes(a.id));
  const prices: Record<string, number> = {};
  for (const a of activeAssets) prices[a.id] = seedPrice(a);
  return {
    account: freshAccount(tuning.startingBalance),
    // Партия начинается со спокойного боковика (раздел 3.4), а не с
    // NEUTRAL_REGIME: у нейтрального maxDurationDays = Infinity, и рынок
    // навсегда застрял бы в режиме без смены — до Фазы 3 это было неважно,
    // потому что режимы вообще не работали.
    marketRegime: makeRegime("sideways"),
    prices,
    candles: {},
    activeAssets,
    activeStyle: TRADING_STYLE_CONFIGS.day,
    gameCalendarDay: 0,
    gameElapsedMs: 0,
    lastDividendQuarter: 0,
    lifestyle: freshLifestyle(),
    lastUpkeepMonth: 0,
    newsFeed: [],
    dayChange: {},
    dayStartEquity: tuning.startingBalance,
    tuning,
    contracts: freshContractState(),
    perks: freshPerkState(),
    contractPoints: 0,
    // Только акции. Облигации приходят вместе со стилем Investing (см.
    // INVESTING_ASSET_IDS), остальные классы — наградой за контракты.
    // Акции, крипта и форекс — с самого начала.
    //
    // Дело не в щедрости, а в расписании. Крипта — единственный рынок,
    // работающий в выходные; форекс идёт неделей одним куском, с вечера
    // воскресенья до вечера пятницы. Вдвоём они закрывают календарь целиком:
    // в любой момент, когда игрок зашёл, ему есть чем торговать. Пока эти
    // рынки открывались наградами, новичок, заглянувший в субботу, не мог
    // сделать ровно ничего — а это два дня из семи.
    unlockedMarkets: ["stock", "crypto", "forex"],
    lastContractResult: null,
    daily: freshDailyState(),
    lastDailyCompleted: [],
    bots: [],
    drawings: {},
    sponsor: null,
    wipedOut: false,
    achievements: [],
    lastAchievements: [],
    streak: freshStreak(),
    publishedStrategies: [],
    tax: freshTaxState(),
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
    unlockedMarkets: state.unlockedMarkets,
    gameCalendarDay: state.gameCalendarDay,
    gameElapsedMs: state.gameElapsedMs,
    lastDividendQuarter: state.lastDividendQuarter,
    lifestyle: state.lifestyle,
    lastUpkeepMonth: state.lastUpkeepMonth,
    newsFeed: state.newsFeed,
    dayStartEquity: state.dayStartEquity,
    contracts: state.contracts,
    perks: state.perks,
    daily: state.daily,
    bots: state.bots,
    drawings: state.drawings,
    sponsor: state.sponsor,
    wipedOut: state.wipedOut,
    achievements: state.achievements,
    streak: state.streak,
    publishedStrategies: state.publishedStrategies,
    tax: state.tax,
    onboardingDone,
    disclaimerSeen,
  };
}

// Чинит историю свечей, если она пришла из сохранения, записанного ДО
// защиты в persistence/gameDb.ts (saveGame) и engine/gameLoop.ts
// (appendPriceToCandles) — сортирует по времени и схлопывает дубликаты
// бакетов (последний виденный побеждает). Идемпотентно на уже здоровых
// данных, поэтому просто всегда прогоняем при загрузке, а не только "если
// похоже на испорченное".
function sanitizeCandleHistory(history: Record<string, Candle[]>): Record<string, Candle[]> {
  const result: Record<string, Candle[]> = {};
  for (const [assetId, candles] of Object.entries(history)) {
    const byTimestamp = new Map<number, Candle>();
    for (const c of [...candles].sort((a, b) => a.timestamp - b.timestamp)) {
      byTimestamp.set(c.timestamp, c);
    }
    result[assetId] = Array.from(byTimestamp.values());
  }
  return result;
}

function normalizeRegime(regime: MarketRegime | undefined): MarketRegime {
  if (!regime || !Number.isFinite(regime.maxDurationDays)) return makeRegime("sideways");
  return regime;
}

function saveToState(save: SaveGame, tuning: GameTuning): GameState {
  // Набор активных активов только РАСТЁТ (раздел 26: открытые позиции нельзя
  // осиротить сменой стиля/перезагрузкой) — берём объединение базовых Фазы 1,
  // того, что уже было активно в сохранении (переживает переключение на
  // investing и обратно), и активов открытых позиций, а не жёстко
  // PHASE1_ASSET_IDS, как раньше (баг: смена стиля на investing не
  // переживала перезагрузку — activeAssets откатывался к 6 тикерам).
  // Старые сохранения знают только про акции — крипту и форекс добавляем:
  // они открыты с начала (см. freshState), и отнимать их у тех, кто начал
  // раньше, было бы наказанием за раннее начало.
  const savedMarkets = (save.unlockedMarkets ?? ["stock"]) as AssetClass[];
  const unlockedMarkets = Array.from(new Set<AssetClass>([...savedMarkets, "stock", "crypto", "forex"]));
  const requiredIds = new Set<string>([
    ...PHASE1_ASSET_IDS,
    ...save.activeAssetIds,
    ...save.account.positions.map((p) => p.assetId),
    ...assetIdsForMarkets(unlockedMarkets),
  ]);
  const activeAssets = ALL_ASSETS.filter((a) => requiredIds.has(a.id));
  const prices = { ...save.prices };
  for (const a of activeAssets) if (prices[a.id] == null) prices[a.id] = seedPrice(a);
  return {
    account: save.account,
    // Сохранения до Фазы 3 лежат с NEUTRAL_REGIME (maxDurationDays =
    // Infinity) — такой режим никогда не сменится, рынок остался бы вечно
    // ровным. Переводим их в обычный боковик.
    marketRegime: normalizeRegime(save.marketRegime),
    prices,
    candles: sanitizeCandleHistory(save.candleHistory),
    activeAssets,
    // Раньше жёстко бралось .day (баг: переключение стиля не переживало
    // перезагрузку) — восстанавливаем реально сохранённый стиль, с
    // фоллбэком на day для старых сохранений/повреждённого значения.
    activeStyle: TRADING_STYLE_CONFIGS[save.activeTradingStyle] ?? TRADING_STYLE_CONFIGS.day,
    gameCalendarDay: save.gameCalendarDay,
    // ?? 0 — только для сохранений, сделанных до появления этого поля;
    // новые всегда пишут реальное значение (см. stateToSave выше).
    gameElapsedMs: save.gameElapsedMs ?? 0,
    lastDividendQuarter: save.lastDividendQuarter ?? 0,
    lifestyle: save.lifestyle ?? freshLifestyle(),
    // Для сохранений, сделанных ДО магазина, отсчёт содержания начинается с
    // ТЕКУЩЕГО игрового месяца, а не с нуля: иначе первый же тик после
    // обновления игры списал бы разом плату за все месяцы, прожитые до
    // покупки первой вещи (на investing-ускорении это сотни месяцев —
    // мгновенное обнуление баланса на ровном месте).
    lastUpkeepMonth: save.lastUpkeepMonth ?? Math.floor((save.gameElapsedMs ?? 0) / MONTH_MS),
    // Лента новостей общая и живёт на сервере — при загрузке она пустая и
    // наполняется первым же ответом котировок.
    newsFeed: [],
    dayChange: {},
    dayStartEquity: save.dayStartEquity ?? save.account.equity,
    contracts: save.contracts ?? freshContractState(),
    perks: save.perks ?? freshPerkState(),
    // Очки за контракты восстанавливаем из истории: отдельно их хранить
    // незачем, а пересчёт по пройденным ступеням защищает от рассинхрона.
    contractPoints: (save.contracts?.completedIds ?? []).reduce((sum, id) => {
      const contract = CONTRACTS.find((c) => c.id === id);
      return sum + (contract?.reward.skillPoints ?? 0);
    }, 0),
    unlockedMarkets,
    lastContractResult: null,
    daily: save.daily ?? freshDailyState(),
    lastDailyCompleted: [],
    bots: save.bots ?? [],
    drawings: save.drawings ?? {},
    // Сохранения до появления спонсора этих полей не знают — у них просто
    // нет долга и нет разорения.
    sponsor: save.sponsor ?? null,
    wipedOut: save.wipedOut ?? false,
    achievements: save.achievements ?? [],
    lastAchievements: [],
    streak: save.streak ?? freshStreak(),
    publishedStrategies: save.publishedStrategies ?? [],
    // Старые сохранения налога не знают: начинаем считать с текущего места
    // журнала, а не облагаем задним числом всю прошлую историю.
    tax: save.tax ?? { ...freshTaxState(), settledTrades: save.account.journal.length },
    // Настройки баланса НЕ сохраняются: они приходят с сервера при каждой
    // загрузке страницы, иначе правка в админке не действовала бы на тех, у
    // кого уже есть сохранение.
    tuning,
  };
}

export type PurchaseResult = { ok: true } | { ok: false; error: PurchaseError };
export type ContractActionResult = { ok: true } | { ok: false; error: StartError };
export type PerkActionResult = { ok: true } | { ok: false; error: PerkError };
export type WorldActionResult = { ok: true } | { ok: false; error: string };

/**
 * Всплывающие уведомления. Живут ТОЛЬКО в памяти и не попадают в сохранение:
 * это реакция на событие «прямо сейчас», а не история — показывать при
 * следующем заходе новость трёхдневной давности незачем.
 */
export type GameNoticeTone = "good" | "bad" | "info";
export interface GameNotice {
  id: string;
  tone: GameNoticeTone;
  text: string;
}

export type OpenPositionResult =
  | { ok: true }
  | { ok: false; error: "insufficient_funds" | "invalid_size" | "unknown_asset" | "invalid_leverage" | "wrong_side" };

interface GameStoreState {
  status: "loading" | "ready";
  game: GameState;
  notices: GameNotice[];
  /** Что произошло, пока вкладка была закрыта. Показывается один раз. */
  offlineReport: OfflineReport | null;
  /** Награда за серию заходов — UI показывает её и гасит. */
  streakBonus: { days: number; amount: number } | null;
  clearStreakBonus: () => void;
  /** Полученные достижения показаны — очистить. */
  clearAchievements: () => void;
  dismissOfflineReport: () => void;
  notify: (tone: GameNoticeTone, text: string) => void;
  dismissNotice: (id: string) => void;
  onboardingDone: boolean;
  disclaimerSeen: boolean;
  init: () => Promise<void>;
  /** Настройки баланса из админки — вызывается страницей ДО init(). */
  setTuning: (tuning: GameTuning) => void;
  /** Забрать свежие котировки общего рынка и разложить их по состоянию. */
  refreshQuotes: () => Promise<void>;
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
  closePosition: (positionId: string, fraction?: number) => void;
  /** Отложенный ордер: лимит или стоп. Исполняет его движок в тике. */
  placeOrder: (input: {
    assetId: string;
    side: PositionSide;
    type: "limit" | "stop";
    size: number;
    level: number;
    leverage?: number;
    stopLoss?: number;
    takeProfit?: number;
    trailingPct?: number;
  }) => OpenPositionResult;
  cancelOrder: (orderId: string) => void;
  /** Запомнить опубликованную стратегию, чтобы слать по ней трек-рекорд. */
  rememberStrategy: (strategyId: string, botId: string) => void;
  /** Принять деньги спонсора после разорения. */
  acceptSponsor: () => void;
  /** Отказаться: счёт остаётся как есть, предложение больше не всплывает. */
  declineSponsor: () => void;
  setTrailing: (positionId: string, trailingPct: number | undefined) => void;
  setStopLoss: (positionId: string, price: number | undefined) => void;
  setTakeProfit: (positionId: string, price: number | undefined) => void;
  setActiveStyle: (style: TradingStyle) => void;
  startContract: (contractId: string) => ContractActionResult;
  abandonContract: () => void;
  unlockPerk: (perkId: string) => PerkActionResult;
  clearContractResult: () => void;
  clearDailyCompleted: () => void;
  addBot: (assetId: string) => void;
  /** Поставить купленную на рынке стратегию в свободный слот бота. */
  addBotFromStrategy: (config: { strategy: string; assetId: string; riskPct: number; stopPct: number; takePct: number }) => void;
  addDrawing: (assetId: string, drawing: GameDrawing) => void;
  removeDrawing: (assetId: string, id: string) => void;
  clearDrawings: (assetId: string) => void;
  updateBot: (id: string, patch: Partial<AlgoBot>) => void;
  removeBot: (id: string) => void;
  /**
   * Деньги, пришедшие ИЗ ОБЩЕГО МИРА (займы, выплаты фондов, проценты).
   * Единственная точка, через которую внешний мир двигает игровой баланс:
   * сервер не хранит деньги игрока, он хранит обязательства.
   */
  applyWorldCash: (amount: number) => void;
  syncWorld: () => Promise<{ claimed: number; defaulted: number } | null>;
  offerLoan: (amount: number, interestPct: number, termDays: number) => Promise<WorldActionResult>;
  cancelLoanOffer: (loanId: string) => Promise<WorldActionResult>;
  takeLoan: (loanId: string) => Promise<WorldActionResult>;
  repayLoan: (loanId: string, amountDue: number) => Promise<WorldActionResult>;
  createFund: (name: string, motto: string, feePct: number) => Promise<WorldActionResult>;
  joinFund: (fundId: string) => Promise<WorldActionResult>;
  leaveFund: () => Promise<WorldActionResult>;
  depositToFund: (amount: number) => Promise<WorldActionResult>;
  withdrawFromFund: (amount: number) => Promise<WorldActionResult>;
  payoutFund: (amount: number) => Promise<WorldActionResult>;
  purchaseShopItem: (itemId: string) => PurchaseResult;
  equipShopTheme: (themeId: string) => void;
  setFundName: (name: string) => void;
  updateJournalEntry: (entryId: string, patch: { tags?: string[]; note?: string }) => void;
  completeOnboarding: () => void;
  acceptDisclaimer: () => void;
  persistNow: () => Promise<void>;
  /** Начать заново: стирает сохранение и создаёт новую партию. */
  resetProgress: () => Promise<void>;
}

let tickHandle: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
let autosaveHandle: ReturnType<typeof setInterval> | null = null;
let worldSyncHandle: ReturnType<typeof setInterval> | null = null;
let quotesHandle: ReturnType<typeof setInterval> | null = null;
let botCandlesHandle: ReturnType<typeof setInterval> | null = null;

export const useGameStore = create<GameStoreState>((set, get) => ({
  status: "loading",
  game: freshState(),
  notices: [],
  offlineReport: null,
  streakBonus: null,

  notify: (tone, text) => {
    // Держим не больше четырёх штук: пятое уведомление вытесняет самое
    // старое, иначе на быстром стиле экран заливает стопкой тостов.
    set((s) => ({ notices: [...s.notices, { id: crypto.randomUUID(), tone, text }].slice(-4) }));
  },

  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

  dismissOfflineReport: () => set({ offlineReport: null }),
  onboardingDone: false,
  disclaimerSeen: false,

  setTuning: (tuning) => {
    // До init() — просто подменяем настройки в свежем состоянии; после —
    // накатываем на текущее (админ мог поменять баланс, пока вкладка жила).
    set((s) => ({ game: { ...s.game, tuning } }));
  },

  refreshQuotes: async () => {
    const { game } = get();
    const ids = game.activeAssets.map((a) => a.id);
    const newsSince = game.newsFeed[0]?.timestamp;
    const data = await fetchQuotes(ids, newsSince ? newsSince + 1 : undefined);
    if (!data) return;

    const prices: Record<string, number> = { ...game.prices };
    const dayChange: Record<string, number> = { ...game.dayChange };
    for (const [assetId, quote] of Object.entries(data.quotes)) {
      prices[assetId] = quote.price;
      dayChange[assetId] = quote.dayChangePct;
    }

    // Новости приходят «свежие сверху»; сливаем с уже показанными и режем
    // ленту, чтобы она не росла бесконечно за длинную сессию.
    const incoming: NewsEvent[] = data.news.map((n) => ({
      id: n.id,
      timestamp: n.ts,
      headline: n.headline,
      affectedAssets: n.assetId ? [n.assetId] : ["*"],
      affectedSectors: n.sector ? [n.sector] : undefined,
      impact: n.impact as NewsEvent["impact"],
      priceShockPct: n.shockPct,
      volatilityMultiplier: 1,
      volatilityDurationCandles: 0,
      expiresAt: n.ts + 60 * 60 * 1000,
      templateId: n.id,
    }));
    const seen = new Set(game.newsFeed.map((n) => n.id));
    const newsFeed = [...incoming.filter((n) => !seen.has(n.id)), ...game.newsFeed].slice(0, 60);

    set((s) => ({
      game: {
        ...s.game,
        prices,
        dayChange,
        newsFeed,
        marketRegime: {
          ...s.game.marketRegime,
          type: data.regime.type as MarketRegime["type"],
          driftModifier: data.regime.driftModifier,
          volModifier: data.regime.volModifier,
          daysInRegime: data.regime.daysInRegime,
        },
      },
    }));
  },

  init: async () => {
    const tuning = get().game.tuning ?? DEFAULT_TUNING;
    const save = await loadGame();
    if (save) {
      const loaded = saveToState(save, tuning);
      // Догон за время отсутствия. Рынок общий и живёт на сервере, поэтому
      // «что случилось, пока меня не было» — это не пересимуляция, а факты:
      // берём исторические свечи своих позиций и смотрим, задело ли стоп.
      const away = Math.max(0, Date.now() - (save.savedAt ?? Date.now()));
      const heldAssets = Array.from(
        new Set(loaded.account.positions.filter((p) => !p.closedAt).map((p) => p.assetId)),
      );
      const quotes = await fetchQuotes(loaded.activeAssets.map((a) => a.id));
      const prices = { ...loaded.prices };
      if (quotes) for (const [id, q] of Object.entries(quotes.quotes)) prices[id] = q.price;

      const history: Record<string, Candle[]> = {};
      if (away > 60_000 && heldAssets.length > 0) {
        // Минутки за время отсутствия — по ним и проверяем стопы. Больше
        // суток берём часовыми: точность внутри дня уже не важна, а
        // тянуть тысячи баров ради этого незачем.
        const useMinutes = away <= 24 * 60 * 60 * 1000;
        const bars = Math.min(1200, Math.ceil(away / (useMinutes ? 60_000 : 3_600_000)) + 5);
        const series = await Promise.all(heldAssets.map((id) => fetchCandles(id, useMinutes ? "1m" : "1h", bars)));
        heldAssets.forEach((id, i) => {
          history[id] = series[i]
            .filter((c) => c.t >= (save.savedAt ?? 0))
            .map((c) => ({ timestamp: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }));
        });
      }

      const { state: advanced, report } = catchUp({ ...loaded, prices }, {
        history,
        prices,
        elapsedMs: away,
        now: Date.now(),
      });
      // Серия заходов отмечается один раз за календарные сутки и сразу
      // платит: смысл серии в том, что награда приходит за сам факт
      // прихода, а не за сделку, которую игрок ещё не сделал.
      const streak = touchStreak(advanced.streak, Date.now());
      const streakPaid = streak !== advanced.streak;
      const bonus = streakPaid ? streakReward(streak.days) : 0;
      set({
        game: {
          ...advanced,
          streak,
          account: bonus > 0 ? { ...advanced.account, balance: advanced.account.balance + bonus } : advanced.account,
        },
        offlineReport: report,
        onboardingDone: save.onboardingDone,
        disclaimerSeen: save.disclaimerSeen,
        status: "ready",
      });
      // Уведомление рисует GameTerminal: перевод живёт там, у стора его нет.
      if (bonus > 0) set({ streakBonus: { days: streak.days, amount: bonus } });
      // Сразу сохраняем догнанное состояние: иначе при быстром закрытии
      // вкладки те же события применились бы второй раз.
      void get().persistNow();
    } else {
      // Новая партия — первый день серии сразу засчитан, но без выплаты:
      // деньги за «зашёл в первый раз» это стартовый капитал, а не бонус.
      const fresh = freshState(tuning);
      set({
        game: { ...fresh, streak: touchStreak(fresh.streak, Date.now()) },
        onboardingDone: false,
        disclaimerSeen: false,
        status: "ready",
      });
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
      set((s) => ({ game: gameTick(dtRealMs, s.game) }));
    }, TICK_INTERVAL_MS);

    if (!autosaveHandle) {
      autosaveHandle = setInterval(() => {
        void get().persistNow();
      }, AUTOSAVE_INTERVAL_MS);
    }

    if (!quotesHandle) {
      void get().refreshQuotes();
      quotesHandle = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void get().refreshQuotes();
      }, QUOTES_INTERVAL_MS);
    }

    if (!botCandlesHandle) {
      const loadBotCandles = async () => {
        const { game } = get();
        const ids = Array.from(new Set(game.bots.filter((b) => b.enabled).map((b) => b.assetId)));
        if (ids.length === 0) return;
        const series = await Promise.all(ids.map((id) => fetchCandles(id, "1m", BOT_CANDLES_LIMIT)));
        set((s) => {
          const candles = { ...s.game.candles };
          ids.forEach((id, i) => {
            candles[id] = series[i].map((c) => ({
              timestamp: c.t,
              open: c.o,
              high: c.h,
              low: c.l,
              close: c.c,
              volume: c.v,
            }));
          });
          return { game: { ...s.game, candles } };
        });
      };
      void loadBotCandles();
      botCandlesHandle = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void loadBotCandles();
      }, BOT_CANDLES_INTERVAL_MS);
    }

    if (!worldSyncHandle) {
      // Первая синхронизация — сразу: игрок должен увидеть себя в мире, не
      // дожидаясь минуты, и забрать причитающиеся деньги.
      void get().syncWorld();
      worldSyncHandle = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void get().syncWorld();
      }, WORLD_SYNC_INTERVAL_MS);
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
    if (worldSyncHandle) {
      clearInterval(worldSyncHandle);
      worldSyncHandle = null;
    }
    if (quotesHandle) {
      clearInterval(quotesHandle);
      quotesHandle = null;
    }
    if (botCandlesHandle) {
      clearInterval(botCandlesHandle);
      botCandlesHandle = null;
    }
  },

  openPosition: ({ assetId, side, size, leverage = 1, stopLoss, takeProfit }) => {
    const { game } = get();
    if (!(size > 0)) return { ok: false, error: "invalid_size" };
    // Потолок плеча — минимум из стиля и настройки админки (0 = не ограничивать).
    const cap = game.tuning.maxLeverageCap > 0
      ? Math.min(game.activeStyle.maxLeverage, game.tuning.maxLeverageCap)
      : game.activeStyle.maxLeverage;
    if (!(leverage >= 1) || leverage > cap) return { ok: false, error: "invalid_leverage" };
    const asset = game.activeAssets.find((a) => a.id === assetId);
    const price = game.prices[assetId];
    if (!asset || price == null) return { ok: false, error: "unknown_asset" };
    // Резерв = requiredMargin (раздел 4.2) — при leverage=1 совпадает с
    // полным номиналом, как в Фазе 1. Раздел 26: сделка дороже доступного
    // баланса отклоняется, ордер не создаётся.
    const cost = calculateRequiredMargin(price, size, leverage);
    if (cost > game.account.balance) return { ok: false, error: "insufficient_funds" };

    // Через общую функцию движка — ту же, которой открываются позиции
    // алго-ботов: резерв маржи обязан считаться одинаково.
    const account: Account = { ...game.account, positions: [...game.account.positions] };
    applyPositionOpen(account, {
      assetId,
      side,
      size,
      leverage,
      entryPrice: price,
      stopLoss,
      takeProfit,
      style: game.activeStyle.style,
    });
    set((s) => ({ game: { ...s.game, account } }));
    return { ok: true };
  },

  placeOrder: ({ assetId, side, type, size, level, leverage = 1, stopLoss, takeProfit, trailingPct }) => {
    const { game } = get();
    if (!(size > 0)) return { ok: false, error: "invalid_size" };
    const cap = game.tuning.maxLeverageCap > 0
      ? Math.min(game.activeStyle.maxLeverage, game.tuning.maxLeverageCap)
      : game.activeStyle.maxLeverage;
    if (!(leverage >= 1) || leverage > cap) return { ok: false, error: "invalid_leverage" };
    const asset = game.activeAssets.find((a) => a.id === assetId);
    const price = game.prices[assetId];
    if (!asset || price == null) return { ok: false, error: "unknown_asset" };
    // Сторону уровня проверяем сразу: лимитка на покупку выше рынка
    // исполнилась бы тем же тиком и хуже рыночного ордера — это опечатка,
    // а не намерение.
    if (validateOrder(type, side, level, price) !== "ok") return { ok: false, error: "wrong_side" };
    // Деньги под заявку НЕ резервируем: пока она не сработала, они у игрока
    // на руках и работают. Не хватит в момент исполнения — заявка сгорит,
    // и это честнее замороженного капитала под ордером, который может
    // простоять неделю.
    if (calculateRequiredMargin(level, size, leverage) > game.account.balance) {
      return { ok: false, error: "insufficient_funds" };
    }
    const order: Order = {
      id: crypto.randomUUID(),
      assetId,
      type,
      side,
      size,
      limitPrice: type === "limit" ? level : undefined,
      stopPrice: type === "stop" ? level : undefined,
      createdAt: Date.now(),
      status: "pending",
      leverage,
      stopLoss,
      takeProfit,
      trailingPct,
      style: game.activeStyle.style,
    };
    set((s) => ({
      game: { ...s.game, account: { ...s.game.account, pendingOrders: [...(s.game.account.pendingOrders ?? []), order] } },
    }));
    return { ok: true };
  },

  rememberStrategy: (strategyId, botId) => {
    set((s) => ({
      game: {
        ...s.game,
        publishedStrategies: [
          ...s.game.publishedStrategies.filter((p) => p.strategyId !== strategyId),
          { strategyId, botId },
        ],
      },
    }));
  },

  acceptSponsor: () => {
    const { game } = get();
    if (game.sponsor) return; // один долг за раз
    const deal = sponsorOffer(game.tuning.startingBalance);
    // Счётчик учтённых сделок ставим на текущую длину журнала: доля берётся
    // только с будущей прибыли, а не задним числом со всей истории.
    const sponsor = { ...deal, settledTrades: game.account.journal.length };
    set((s) => ({
      game: {
        ...s.game,
        sponsor,
        wipedOut: false,
        account: {
          ...s.game.account,
          balance: s.game.account.balance + deal.stake,
          // Разорение стоит репутации: иначе оно превратилось бы в способ
          // бесплатно перезагружать счёт, когда сделка не пошла.
          reputation: Math.max(0, s.game.account.reputation - WIPEOUT_PRESTIGE_PENALTY),
        },
      },
    }));
  },

  declineSponsor: () => {
    set((s) => ({ game: { ...s.game, wipedOut: false } }));
  },

  cancelOrder: (orderId) => {
    set((s) => ({
      game: {
        ...s.game,
        account: { ...s.game.account, pendingOrders: (s.game.account.pendingOrders ?? []).filter((o) => o.id !== orderId) },
      },
    }));
  },

  setTrailing: (positionId, trailingPct) => {
    set((s) => ({
      game: {
        ...s.game,
        account: {
          ...s.game.account,
          positions: s.game.account.positions.map((p) => (p.id === positionId ? { ...p, trailingPct } : p)),
        },
      },
    }));
  },

  closePosition: (positionId, fraction) => {
    const { game } = get();
    const position = game.account.positions.find((p) => p.id === positionId && !p.closedAt);
    if (!position) return;
    const price = game.prices[position.assetId];
    if (price == null) return;
    // Доля закрытия: 1 (или не задано) — вся позиция. Ниже одной сотой не
    // опускаемся, иначе «частичное» закрытие превращается в способ
    // бесплатно перебирать комиссии.
    const closeSize =
      fraction != null && fraction > 0 && fraction < 1
        ? Math.max(position.size * 0.01, position.size * fraction)
        : undefined;
    const account: Account = { ...game.account, positions: [...game.account.positions], journal: [...game.account.journal] };
    // Комиссия по стилю, под которым позиция была открыта — см. комментарий
    // у аналогичного места в gameLoop.ts (авто-закрытие по SL/TP/ликвидации).
    // Комиссия и опыт — с учётом перков, ровно как при авто-закрытии в
    // движке: ручное закрытие не должно стоить дороже, чем срабатывание
    // стопа по той же позиции.
    const effects = perkEffects(game.perks);
    applyPositionClose(
      account,
      position,
      price,
      TRADING_STYLE_CONFIGS[position.style].commissionRate * effects.commissionMultiplier,
      0,
      game.tuning.xpMultiplier * effects.xpMultiplier,
      game.gameCalendarDay,
      closeSize,
    );
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
    // Investing (Фаза 5) требует более широкого набора активов, чем 6
    // тикеров Фазы 1 — ДОБАВЛЯЕМ недостающие в activeAssets/prices/candles,
    // а не заменяем список: иначе позиции, открытые в предыдущем стиле,
    // остались бы без ценового потока (см. saveToState — тот же принцип
    // «только рост» применён и при восстановлении сохранения).
    set((s) => {
      // К набору стиля добавляем инструменты открытых рынков: разблокировав
      // крипту контрактом, игрок должен увидеть её в тикете, а не искать,
      // где она включается.
      const requiredIds = [...assetIdsForStyle(style), ...assetIdsForMarkets(s.game.unlockedMarkets)];
      const existingIds = new Set(s.game.activeAssets.map((a) => a.id));
      const missing = ALL_ASSETS.filter((a) => requiredIds.includes(a.id) && !existingIds.has(a.id));
      if (missing.length === 0) return { game: { ...s.game, activeStyle: config } };
      const prices = { ...s.game.prices };
      const candles = { ...s.game.candles };
      for (const a of missing) {
        prices[a.id] = seedPrice(a);
        candles[a.id] = [];
      }
      return {
        game: { ...s.game, activeStyle: config, activeAssets: [...s.game.activeAssets, ...missing], prices, candles },
      };
    });
    void get().persistNow();
  },

  // Контракты — цель игрока. Взнос списывается сразу и не возвращается:
  // испытание, которое ничего не стоит, не создаёт напряжения.
  startContract: (contractId) => {
    const { game } = get();
    const account: Account = { ...game.account, positions: [...game.account.positions], journal: [...game.account.journal] };
    const result = startContract(account, game.contracts, contractId, game.gameCalendarDay);
    if (!result.ok) return result;
    set((s) => ({ game: { ...s.game, account, contracts: result.state } }));
    void get().persistNow();
    return { ok: true };
  },

  abandonContract: () => {
    set((s) => ({ game: { ...s.game, contracts: abandonContract(s.game.contracts, s.game.gameCalendarDay) } }));
    void get().persistNow();
  },

  unlockPerk: (perkId) => {
    const { game } = get();
    const points = availablePoints(game.account.skills, game.contractPoints, game.perks);
    const result = unlockPerk(game.perks, perkId, points);
    if (!result.ok) return result;
    set((s) => ({ game: { ...s.game, perks: result.perks } }));
    void get().persistNow();
    return { ok: true };
  },

  clearContractResult: () => set((s) => ({ game: { ...s.game, lastContractResult: null } })),
  clearDailyCompleted: () => set((s) => ({ game: { ...s.game, lastDailyCompleted: [] } })),

  clearStreakBonus: () => set({ streakBonus: null }),

  clearAchievements: () => set((s) => ({ game: { ...s.game, lastAchievements: [] } })),

  // Разметка графика. Живёт в сохранении игры: инструменты и время здесь
  // игровые, и в общей таблице рисунков проекта им не место.
  addDrawing: (assetId, drawing) => {
    set((s) => ({
      game: {
        ...s.game,
        drawings: { ...s.game.drawings, [assetId]: [...(s.game.drawings[assetId] ?? []), drawing] },
      },
    }));
    void get().persistNow();
  },

  removeDrawing: (assetId, id) => {
    set((s) => ({
      game: {
        ...s.game,
        drawings: { ...s.game.drawings, [assetId]: (s.game.drawings[assetId] ?? []).filter((d) => d.id !== id) },
      },
    }));
    void get().persistNow();
  },

  clearDrawings: (assetId) => {
    set((s) => ({ game: { ...s.game, drawings: { ...s.game.drawings, [assetId]: [] } } }));
    void get().persistNow();
  },

  addBot: (assetId) => {
    const { game } = get();
    // Больше слотов, чем куплено перками, завести нельзя — иначе перк ветки
    // «Автоматика» ничего бы не значил.
    if (game.bots.length >= botSlots(game.perks.unlocked)) return;
    const bot: AlgoBot = { id: crypto.randomUUID(), ...defaultBot(assetId) };
    set((s) => ({ game: { ...s.game, bots: [...s.game.bots, bot] } }));
    void get().persistNow();
  },

  addBotFromStrategy: (config) => {
    const { game } = get();
    const slots = botSlots(game.perks.unlocked);
    const bot: AlgoBot = {
      id: crypto.randomUUID(),
      assetId: config.assetId,
      strategy: config.strategy as AlgoBot["strategy"],
      riskPct: config.riskPct,
      stopPct: config.stopPct,
      takePct: config.takePct,
      enabled: true,
    };
    set((s) => {
      // Свободных слотов нет — заменяем последнего бота: купленная стратегия
      // должна где-то заработать, иначе покупка бессмысленна.
      const bots = s.game.bots.length < slots ? [...s.game.bots, bot] : [...s.game.bots.slice(0, Math.max(0, slots - 1)), bot];
      return { game: { ...s.game, bots } };
    });
    void get().persistNow();
  },

  updateBot: (id, patch) => {
    set((s) => ({
      game: { ...s.game, bots: s.game.bots.map((b) => (b.id === id ? { ...b, ...patch } : b)) },
    }));
    void get().persistNow();
  },

  removeBot: (id) => {
    set((s) => ({ game: { ...s.game, bots: s.game.bots.filter((b) => b.id !== id) } }));
    void get().persistNow();
  },

  applyWorldCash: (amount) => {
    if (!Number.isFinite(amount) || amount === 0) return;
    set((s) => ({
      game: {
        ...s.game,
        // Баланс не уходит в минус: если игрок успел потратить деньги до
        // возврата займа, недостающее просто не списывается — долг при этом
        // на сервере уже закрыт, а «отрицательный кошелёк» сломал бы весь
        // остальной движок (см. chargeUpkeep — там то же правило).
        account: { ...s.game.account, balance: Math.max(0, s.game.account.balance + amount) },
      },
    }));
    void get().persistNow();
  },

  syncWorld: async () => {
    const { game } = get();
    const levels = Object.values(game.account.skills).map((s) => s.level);
    const best = game.contracts.history
      .filter((r) => r.outcome === "passed")
      .reduce((max, r) => Math.max(max, r.resultPct), 0);
    const result = await syncSnapshot({
      fundName: game.lifestyle.fundName || null,
      rankKey: traderRankKey(game.account.reputation),
      prestige: Math.round(game.account.reputation),
      level: levels.length > 0 ? Math.max(...levels) : 0,
      equity: game.account.equity,
      contractsPassed: game.contracts.completedIds.length,
      bestContractPct: best,
      activeStyle: game.activeStyle.style,
      gameDay: game.gameCalendarDay,
    });
    if (!result.ok) return null;
    // Причитающиеся деньги сервер отдаёт ровно один раз — зачисляем их сразу,
    // иначе они потеряются: на сервере счётчик уже обнулён.
    if (result.data.claimed > 0) {
      get().applyWorldCash(result.data.claimed);
      get().notify("good", `+${Math.round(result.data.claimed).toLocaleString("ru-RU")} $ из мира`);
    }
    if (result.data.defaulted > 0) {
      get().notify("bad", `Просрочено займов: ${result.data.defaulted}. Репутация упала.`);
    }

    // Трек-рекорд опубликованных стратегий. Отправляем вместе с синхронизацией
    // мира: сервер игровых сделок не видит — счёт живёт в браузере, — поэтому
    // историю бота может прислать только его хозяин.
    if (game.publishedStrategies.length > 0) {
      const records = game.publishedStrategies
        .map(({ strategyId, botId }) => ({ strategyId, record: botRecord(game.account.positions, botId) }))
        .filter(({ record }) => record.trades > 0)
        .map(({ strategyId, record }) => ({
          strategyId,
          trades: record.trades,
          winRate: record.winRate,
          avgPnl: record.avgPnl,
        }));
      if (records.length > 0) void strategiesApi.report(records);
    }

    return { claimed: result.data.claimed, defaulted: result.data.defaulted };
  },

  offerLoan: async (amount, interestPct, termDays) => {
    const { game } = get();
    if (amount > game.account.balance) return { ok: false, error: "Недостаточно денег на балансе" };
    const result = await loansApi.offer(amount, interestPct, termDays);
    if (!result.ok) return { ok: false, error: result.error };
    // Деньги «уходят на биржу» сразу — иначе один и тот же миллион можно
    // было бы предложить десяти игрокам.
    get().applyWorldCash(-amount);
    return { ok: true };
  },

  cancelLoanOffer: async (loanId) => {
    const result = await loansApi.cancel(loanId);
    if (!result.ok) return { ok: false, error: result.error };
    get().applyWorldCash(result.data.refund);
    return { ok: true };
  },

  takeLoan: async (loanId) => {
    const { game } = get();
    const bonus = perkEffects(game.perks).loanLimitBonus;
    const result = await loansApi.take(loanId, game.gameCalendarDay, bonus);
    if (!result.ok) return { ok: false, error: result.error };
    get().applyWorldCash(result.data.amount);
    return { ok: true };
  },

  repayLoan: async (loanId, amountDue) => {
    const { game } = get();
    if (amountDue > game.account.balance) return { ok: false, error: "Недостаточно денег, чтобы вернуть долг" };
    const result = await loansApi.repay(loanId);
    if (!result.ok) return { ok: false, error: result.error };
    get().applyWorldCash(-result.data.paid);
    return { ok: true };
  },

  createFund: async (name, motto, feePct) => {
    const result = await fundsApi.create(name, motto, feePct);
    if (!result.ok) return { ok: false, error: result.error };
    get().applyWorldCash(-result.data.cost);
    return { ok: true };
  },

  joinFund: async (fundId) => {
    const result = await fundsApi.join(fundId);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  },

  leaveFund: async () => {
    const result = await fundsApi.leave();
    if (!result.ok) return { ok: false, error: result.error };
    get().applyWorldCash(result.data.refund);
    return { ok: true };
  },

  depositToFund: async (amount) => {
    const { game } = get();
    if (amount > game.account.balance) return { ok: false, error: "Недостаточно денег на балансе" };
    const result = await fundsApi.deposit(amount);
    if (!result.ok) return { ok: false, error: result.error };
    get().applyWorldCash(-amount);
    return { ok: true };
  },

  withdrawFromFund: async (amount) => {
    const result = await fundsApi.withdraw(amount);
    if (!result.ok) return { ok: false, error: result.error };
    get().applyWorldCash(result.data.amount);
    return { ok: true };
  },

  payoutFund: async (amount) => {
    // Выплату распределяет сервер: доля каждого участника падает ему в
    // pendingPayout, включая владельца. Свой баланс здесь не трогаем.
    const result = await fundsApi.payout(amount);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  },

  // Магазин (раздел 13). Проверка и списание — в движке
  // (economy/shop.ts), стор только копирует account под мутацию и сразу
  // персистит: покупка за 250 тысяч, потерянная из-за закрытой вкладки до
  // ближайшего автосейва (раз в 60с), выглядела бы как воровство.
  purchaseShopItem: (itemId) => {
    const { game } = get();
    const item = getShopItem(itemId);
    const check = canPurchase(item, game.account.balance, game.lifestyle, game.account.reputation);
    if (!check.ok || !item) return check.ok ? { ok: false, error: "unknown_item" } : check;
    const account: Account = { ...game.account, positions: [...game.account.positions], journal: [...game.account.journal] };
    const lifestyle = applyPurchase(account, game.lifestyle, item);
    set((s) => ({ game: { ...s.game, account, lifestyle } }));
    void get().persistNow();
    return { ok: true };
  },

  equipShopTheme: (themeId) => {
    set((s) => ({ game: { ...s.game, lifestyle: equipTheme(s.game.lifestyle, themeId) } }));
    void get().persistNow();
  },

  setFundName: (name) => {
    // Обрезаем до 40 символов на входе в стор, а не только в поле ввода:
    // сохранение уедет в IndexedDB и потом в заголовок терминала, а
    // ограничение input-а обходится вставкой из буфера.
    set((s) => ({ game: { ...s.game, lifestyle: { ...s.game.lifestyle, fundName: name.trim().slice(0, 40) } } }));
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

  resetProgress: async () => {
    // Сначала стираем слот, потом ставим свежее состояние: если сделать
    // наоборот, автосейв успеет записать новую партию поверх — и удаление
    // не сработает.
    await deleteSave();
    set({ game: freshState(get().game.tuning), onboardingDone: true, disclaimerSeen: true });
    await get().persistNow();
    get().notify("info", "Прогресс сброшен, новая партия началась");
  },

  persistNow: async () => {
    const { game, onboardingDone, disclaimerSeen } = get();
    await saveGame(stateToSave(game, onboardingDone, disclaimerSeen));
  },
}));
