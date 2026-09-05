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
  // Цена, с которой инструмент начинает историю. Раньше все стартовали со
  // 100 — по графику было не понять, торгуешь ты индексом, парой EUR/USD или
  // биткоином. Теперь у каждого своя, близкая к настоящей.
  startPrice: number;
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
  // Ордер несёт весь план сделки, а не только вход: смысл отложенного ордера
  // в том, чтобы поставить его и уйти, а стоп, выставленный руками через
  // час после срабатывания, от этого ничего не защищает.
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  trailingPct?: number;
  /** Срок жизни; не задан — до отмены. */
  expiresAt?: number;
  style?: TradingStyle;
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
  /**
   * Скользящий стоп: доля в процентах, на которую стоп тянется за ценой.
   * Отдельного «лучшего курса» не храним — он восстанавливается из самого
   * stopLoss, потому что стоп двигается только в сторону прибыли.
   */
  trailingPct?: number;
  /**
   * Кем открыта позиция: id алго-бота или ничего, если рукой.
   *
   * Нужна для честного трек-рекорда на рынке стратегий: без метки сделки
   * бота неотличимы от ручных, и «доходность стратегии» пришлось бы либо
   * брать со слов продавца, либо не показывать вовсе.
   */
  botId?: string;
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
  // Игровой день закрытия. Реального времени (timestampClosed) для дневных
  // заданий недостаточно: игровой день на investing проходит за секунды.
  gameDay: number;
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

// Знак шока: спека оставляла его на волю генератора, но случайный знак у
// «Аналитики ПОВЫСИЛИ прогноз» выглядел бы враньём. Поэтому у каждого шаблона
// в newsTemplates.json проставлена полярность (размечено вручную): mixed —
// это события, которые рынок реально может отыграть в любую сторону
// (слияние, смена CEO, сокращение штата), только для них знак случайный.
export type NewsPolarity = "positive" | "negative" | "mixed";

export interface NewsTemplate {
  id: string;
  impact: NewsImpact;
  polarity: NewsPolarity;
  template: string;
  targetType: NewsTargetType;
  shockRange: [number, number]; // амплитуда шока (доля), знак — по полярности выше
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
  // Не из раздела 2 буквально. Длина свечи зависит от активного стиля
  // (candleIntervalMs в gameLoop.ts), поэтому «жить N свечей» — величина,
  // которая менялась бы у уже вышедшей новости при переключении стиля.
  // Момент истечения фиксируется в игровом времени ОДИН раз, при генерации.
  expiresAt: number;
  // templateId + subject хранятся для будущей локализации ленты: сейчас
  // headline собран из русского шаблона и лежит готовой строкой (шаблоны в
  // newsTemplates.json только на русском), но с этими полями англоязычный
  // файл шаблонов можно будет подставить, не теряя уже вышедшие новости.
  templateId: string;
  subject?: string;
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

// ── Магазин и образ жизни трейдера (раздел 13 спеки) ────────────────────────
// F2P-safe по построению: покупки НЕ влияют ни на RNG, ни на исполнение
// ордеров, ни на комиссии — только на внешний вид терминала, престиж
// (account.reputation) и ежемесячные расходы на содержание. Ни один предмет
// не даёт торгового преимущества, поэтому «магазин» нельзя превратить в
// pay-to-win, даже если когда-нибудь появится реальная монетизация.
export type ShopCategory = "theme" | "gear" | "lifestyle" | "status";

export interface ShopItemTheme {
  accent: string; // подменяет --color-accent внутри терминала игры
  up: string; // цвет растущей свечи
  down: string; // цвет падающей свечи
}

export interface ShopItem {
  id: string;
  category: ShopCategory;
  price: number;
  upkeepPerMonth: number; // расход на содержание, списывается раз в игровой месяц
  prestige: number; // сколько очков репутации (account.reputation) даёт покупка
  requiresPrestige: number; // порог репутации, ниже которого предмет не продаётся
  icon: string;
  theme?: ShopItemTheme; // только у category === "theme"
  // Насколько предмет ускоряет восстановление от стресса (раздел 4.4).
  // Это ЕДИНСТВЕННОЕ влияние покупок на игру: они возвращают игрока в
  // норму, но не делают сильнее нормы, и на сам рынок не влияют никак.
  rest?: number;
}

export interface LifestyleState {
  ownedItemIds: string[];
  equippedThemeId: string | null;
  fundName: string; // пустая строка — фонд ещё не назван (нужен предмет status_fund)
  totalSpent: number; // суммарно потрачено на покупки — для статистики в UI
  totalUpkeepPaid: number; // суммарно уплачено за содержание
  unpaidUpkeep: number; // сколько не смогли списать (баланс кончился) — повод для предупреждения
}

// ── Контракты (испытания) — ядро игрового цикла ────────────────────────────
// Формат заимствован у prop-firm челленджей: игроку дают цель по доходности
// и ЖЁСТКИЙ лимит просадки на ограниченный срок. Именно лимит просадки
// превращает риск-менеджмент из теории в единственный способ пройти дальше:
// «заработал 100% и чуть не слил» здесь объективно проигрывает «сделал 8%
// ровно».
export interface ContractReward {
  cash: number;
  prestige: number;
  skillPoints: number;
  unlockMarkets: AssetClass[];
}

export interface Contract {
  id: string;
  tier: number;
  targetPct: number; // цель по доходности от стартовой эквити, %
  maxDrawdownPct: number; // допустимая просадка от пика эквити, %
  durationDays: number; // срок в игровых днях
  entryFee: number; // взнос, сгорает при провале
  reward: ContractReward;
}

export type ContractOutcome = "passed" | "failed_drawdown" | "failed_expired" | "abandoned";

export interface ActiveContract {
  contractId: string;
  startedDay: number;
  startEquity: number;
  peakEquity: number; // максимум эквити с начала контракта — от него считается просадка
}

export interface ContractRecord {
  contractId: string;
  outcome: ContractOutcome;
  finishedDay: number;
  resultPct: number;
}

export interface ContractState {
  active: ActiveContract | null;
  history: ContractRecord[];
  completedIds: string[]; // пройденные — второй раз не выдаются
}

// ── Перки ──────────────────────────────────────────────────────────────────
// Правило, которое нельзя нарушать: НИ ОДИН перк не предсказывает цену и не
// улучшает исполнение в свою пользу. Перк даёт инструмент, условие
// (комиссия, маржа), доступ к рынку или скорость роста — то есть меняет,
// ВО ЧТО играешь, а не подкручивает результат.
export type PerkBranch = "tools" | "terms" | "growth" | "social" | "algo";

export interface Perk {
  id: string;
  branch: PerkBranch;
  cost: number; // очков навыка
  requires: string[]; // id перков, без которых не открыть
}

export interface PerkState {
  unlocked: string[];
  spentPoints: number;
}

import type { DailyState } from "@/engine/player/dailyTasks";
import type { AlgoBot } from "@/engine/player/algoBots";

// ── Разметка на графике ────────────────────────────────────────────────────
// Свои рисунки игрока: трендовая линия, горизонтальный уровень,
// прямоугольник. Хранятся В САМОЙ ИГРЕ (IndexedDB вместе с сохранением), а не
// в таблице UserDrawing, как на форексе: та привязана к реальному инструменту
// и реальному времени, а здесь и то и другое — игровое.
//
// Точки хранятся в координатах ДАННЫХ (игровое время + цена), а не в
// пикселях: иначе разметка разъезжалась бы при любом зуме и смене размера
// окна.
// Набор тот же, что на форексе и карте ордеров (DrawingToolbar.tsx):
// трендовая, горизонтальная линия, горизонтальный луч, прямоугольник. Плюс
// вертикальная отметка — на игровом графике ей есть применение, которого нет
// на реальном: отметить момент выхода новости.
export type GameDrawingKind = "trend" | "level" | "ray" | "rect" | "vline";

export interface GameDrawingPoint {
  t: number;
  price: number;
}

export interface GameDrawing {
  id: string;
  kind: GameDrawingKind;
  points: GameDrawingPoint[];
}

export interface StreakState {
  /** Сколько дней подряд игрок заходил. */
  days: number;
  /** Календарный день последнего захода (UTC-сутки от эпохи). */
  lastDay: number;
  /** Лучшая серия за всё время — её не отнимает даже пропуск. */
  best: number;
}

export interface SponsorDeal {
  /** Сколько денег дали. */
  stake: number;
  /** Сколько ещё осталось вернуть. */
  owed: number;
  /** Какая доля КАЖДОЙ прибыльной сделки уходит спонсору, %. */
  sharePct: number;
  /** Когда договорились — для истории и для UI. */
  signedAt: number;
  /**
   * Сколько записей журнала уже учтено при расчёте доли.
   *
   * Доля считается по журналу, а не по месту закрытия позиции, потому что
   * закрывают её три разных пути: стоп, ликвидация и рука игрока — и только
   * журнал видит все три одинаково. Счётчик нужен, чтобы одна и та же
   * сделка не оплатила долю дважды.
   */
  settledTrades: number;
}

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
  // Раздел 13 — покупки/косметика и номер последнего игрового месяца, за
  // который уже списаны расходы на содержание (симметрично
  // lastDividendQuarter: дивиденды — доход, upkeep — расход).
  lifestyle: LifestyleState;
  lastUpkeepMonth: number;
  // Раздел 3.5 — лента заголовков для UI. Активные (ещё действующие)
  // новости в сохранение не пишутся: всплеск волатильности привязан к
  // игровому времени и к тому, что игрок в этот момент смотрел на график.
  newsFeed: NewsEvent[];
  // Эквити на начало текущего игрового дня — дневной результат в шапке.
  dayStartEquity: number;
  // Контракты и перки (ядро прогрессии).
  contracts: ContractState;
  perks: PerkState;
  // Ежедневные задания: номер дня и что из него уже засчитано.
  daily: DailyState;
  // Алго-боты: торгуют сами, в том числе во время офлайн-прогресса.
  bots: AlgoBot[];
  // Разметка игрока по инструментам.
  drawings: Record<string, GameDrawing[]>;
  // Договор со спонсором после разорения и флаг «счёт разорён, ответа ещё
  // не было». Необязательные: сохранения, сделанные до их появления, просто
  // не знают про долг.
  sponsor?: SponsorDeal | null;
  wipedOut?: boolean;
  // Полученные достижения и серия заходов. Тоже необязательные — старые
  // сохранения про них не знают, у них просто пустая коллекция.
  achievements?: string[];
  streak?: StreakState;
  publishedStrategies?: Array<{ strategyId: string; botId: string }>;
  onboardingDone: boolean;
  disclaimerSeen: boolean;
}
