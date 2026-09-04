// Типы игровых сущностей — раздел 2 инженерной спецификации
// (trading_game_full_spec.md). Пишем полный набор сразу (не только то, что
// использует Фаза 1), чтобы поздние фазы расширяли поведение, а не
// пересобирали структуры данных (инструкция 0.3 спеки).

export type AssetClass = "stock" | "forex" | "crypto" | "commodity" | "index" | "bond" | "option" | "future";

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  sector?: string;
  correlationGroup: string;
  baseVolatility: number; // годовая волатильность, напр. 0.25 = 25%
  baseDrift: number; // годовой снос (тренд), напр. 0.05 = 5%/год
  tickSize: number;
  tradingHours: "always" | "session";
  dividendYield?: number;
  compositeOf?: string; // для индексов — из какой correlationGroup складывается
}

export interface Candle {
  timestamp: number; // unix ms, игровое время
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type PositionSide = "long" | "short";

export interface Order {
  id: string;
  assetId: string;
  type: OrderType;
  side: PositionSide;
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  createdAt: number;
  status: "pending" | "filled" | "cancelled";
}

export interface Position {
  id: string;
  assetId: string;
  side: PositionSide;
  entryPrice: number;
  size: number;
  leverage: number; // 1 = без плеча
  stopLoss?: number;
  takeProfit?: number;
  openedAt: number;
  closedAt?: number;
  closePrice?: number;
  realizedPnl?: number;
  fees: number;
  style: TradingStyle;
}

export type TradingStyle =
  | "scalping"
  | "day"
  | "swing"
  | "position"
  | "investing"
  | "algo"
  | "arbitrage"
  | "market_making"
  | "options";

export interface UnlockRequirement {
  minAccountBalance?: number;
  minTradesCompleted?: number;
  minSkillLevel?: Partial<Record<TradingStyle, number>>;
  requiredLicense?: string;
}

export interface TradingStyleConfig {
  style: TradingStyle;
  minHoldTimeMs: number; // мс игрового времени
  timeAcceleration: number; // множитель игрового времени относительно реального
  maxLeverage: number;
  commissionRate: number; // доля от объёма сделки
  spreadMultiplier: number; // множитель к базовому спреду актива
  unlockRequirement: UnlockRequirement;
}

export interface SkillTree {
  [style: string]: {
    level: number; // 0-10
    xp: number;
    xpToNextLevel: number;
  };
}

export interface PsychologyState {
  stress: number; // 0-100
  confidence: number; // 0-100, около 50 — нейтрально
  discipline: number; // 0-100, прокачиваемый скилл
  consecutiveWins: number;
  consecutiveLosses: number;
  lastTradeAt: number;
}

export interface JournalEntry {
  id: string;
  positionId: string;
  timestampClosed: number;
  pnl: number;
  rMultiple: number; // PnL / initial risk
  tags: string[];
  note?: string;
}

export interface Account {
  id: string;
  balance: number; // свободные средства
  equity: number; // balance + unrealized PnL
  positions: Position[];
  pendingOrders: Order[];
  marginUsed: number;
  marginLevel: number; // equity / marginUsed * 100%
  psychology: PsychologyState;
  skills: SkillTree;
  reputation: number;
  licenses: string[];
  journal: JournalEntry[];
}

export type NewsImpact = "low" | "medium" | "high" | "black_swan";
export type NewsTargetType = "asset" | "sector" | "global";

export interface NewsTemplate {
  id: string;
  impact: NewsImpact;
  template: string;
  targetType: NewsTargetType;
  shockRange: [number, number]; // амплитуда шока (доля), знак выбирается при генерации
}

export interface NewsEvent {
  id: string;
  timestamp: number;
  headline: string;
  affectedAssets: string[]; // asset id, или ["*"] для всего рынка
  affectedSectors?: string[];
  impact: NewsImpact;
  priceShockPct: number; // мгновенный скачок цены при выходе новости (со знаком)
  volatilityMultiplier: number;
  volatilityDurationCandles: number;
}

export type MarketRegimeType = "bull" | "bear" | "sideways" | "high_volatility" | "crisis";

export interface MarketRegime {
  type: MarketRegimeType;
  driftModifier: number; // множитель к μ всех активов
  volModifier: number; // множитель к σ всех активов
  minDurationDays: number;
  maxDurationDays: number;
  daysInRegime: number;
}

// Нейтральный режим — используется в Фазе 1, где рыночные режимы (раздел 3.4)
// ещё не реализованы: driftModifier/volModifier = 1 не меняют формулу 3.2.
export const NEUTRAL_REGIME: MarketRegime = {
  type: "sideways",
  driftModifier: 1,
  volModifier: 1,
  minDurationDays: 0,
  maxDurationDays: Infinity,
  daysInRegime: 0,
};

export interface SaveGame {
  version: string; // для миграций схемы между версиями игры
  savedAt: number;
  account: Account;
  marketRegime: MarketRegime;
  prices: Record<string, number>; // текущие цены всех известных активов
  candleHistory: Record<string, Candle[]>; // ограниченная глубина
  activeAssetIds: string[]; // какие активы «включены» в текущей фазе
  activeTradingStyle: TradingStyle;
  unlockedStyles: TradingStyle[];
  unlockedMarkets: AssetClass[];
  gameCalendarDay: number; // игровой день с начала партии
  // Не из раздела 12 спеки буквально — но без него gameElapsedMs после
  // каждой загрузки обнулялся бы, а candleHistory уже содержит метки
  // времени из прошлой партии: новые свечи начинали бы бакетироваться
  // заново от 0 поверх старых, и график рисовал бы две дорожки друг на
  // друге (поймано вручную — см. gameStore.ts saveToState/stateToSave).
  gameElapsedMs: number;
  // Раздел 4.6 — номер последнего игрового квартала, за который уже
  // заплачены дивиденды/купоны (см. gameLoop.ts, шаг 6). Без сохранения
  // каждая загрузка снова платила бы за уже оплаченный квартал.
  lastDividendQuarter: number;
  onboardingDone: boolean;
  disclaimerSeen: boolean;
}
