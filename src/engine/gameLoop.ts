// Главный тик игры.
//
// ВАЖНО: цены здесь больше НЕ рождаются. Рынок общий и живёт на сервере
// (src/lib/game/marketStore.ts) — стор кладёт свежие котировки в state.prices
// и свечи в state.candles, а тик только применяет их к счёту игрока:
// стоп/тейк, ликвидации, маржа, дивиденды, содержание, контракты, задания,
// психология и алго-боты.
//
// Так и должно быть: пока цену считал каждый браузер сам, у всех был свой
// рынок, история умирала вместе с вкладкой, а сравнивать результаты в общем
// мире было не с чем.
import type {
  Account,
  Asset,
  AssetClass,
  Candle,
  ContractRecord,
  ContractState,
  GameDrawing,
  LifestyleState,
  MarketRegime,
  NewsEvent,
  Order,
  PerkState,
  Position,
  TradingStyleConfig,
} from "@/engine/entities/types";
import { applyContractReward, evaluateContract, getContract } from "@/engine/player/contracts";
import { perkEffects } from "@/engine/player/perks";
import { applySponsorCut, isWipedOut, sponsorCut, type SponsorDeal } from "@/engine/player/bailout";
import { orderTriggers, trailStop, triggerLevel } from "@/engine/player/pendingOrders";
import { isMarketOpen } from "@/lib/game/schedule";
import { evaluateDaily, freshDailyState, type DailyState, type DailyTask } from "@/engine/player/dailyTasks";
import {
  botHasPosition,
  botPositionSize,
  botSignal,
  botSlots,
  botStopLoss,
  botTakeProfit,
  type AlgoBot,
} from "@/engine/player/algoBots";
import { DEFAULT_MAINTENANCE_MARGIN_RATE } from "@/engine/economy/marginEngine";
import { DEFAULT_TUNING, type GameTuning } from "@/engine/entities/tuning";
import { calculateUnrealizedPnl, settleClose } from "@/engine/economy/pnlCalculator";
import {
  calculateLiquidationPenalty,
  calculateLiquidationPrice,
  calculateMarginLevel,
  calculateRequiredMargin,
  checkLiquidation,
} from "@/engine/economy/marginEngine";
import { applyXpGain, calculateXpGain, xpToNextLevel, BASE_XP } from "@/engine/player/progression";
import { processQuarterlyDividends } from "@/engine/economy/dividends";
import { chargeUpkeep, monthlyUpkeep, restFactor } from "@/engine/economy/shop";
import { applySlippage, applyTradeOutcome, recoverOverTime } from "@/engine/player/psychology";
import { TRADING_STYLE_CONFIGS } from "@/engine/entities/tradingStyleConfigs";

// Длина одной свечи. Игровое время теперь идёт вровень с реальным, поэтому
// минутная свеча — это ровно минута жизни: как в настоящем терминале.
// Формирующаяся свеча при этом обновляется на каждом тике (4 раза в
// секунду), так что график живой, а не дёргается раз в минуту.
//
// Историю ограничивает MAX_CANDLES_PER_ASSET: 500 минуток — это около
// восьми часов, дальше старое уезжает. Более крупные таймфреймы график
// собирает из этих же минуток (см. aggregateCandles в PriceChart.tsx).
export const CANDLE_INTERVAL_MS = 60 * 1000;

/**
 * Оставлена как функция ради одной точки правды и на случай режима
 * перемотки: сейчас все стили идут в реальном времени, и длина свечи от
 * стиля не зависит.
 */
export function candleIntervalMs(_timeAcceleration = 1): number {
  return CANDLE_INTERVAL_MS;
}
export const MAX_CANDLES_PER_ASSET = 500;
// Период выплаты дивидендов (раздел 4.6). Раньше это был «игровой квартал» в
// 90 дней — при ускорении 43200x он проходил за минуту. Теперь время
// реальное, и квартал означал бы, что дивиденды не увидит вообще никто:
// платим раз в неделю, а годовую доходность делим на 52 (см.
// PAYMENTS_PER_YEAR в economy/dividends.ts) — сумма за год та же.
export const DIVIDEND_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
// "Игровой месяц" (раздел 13) — 30 игровых дней, ровно треть квартала выше:
// расход на образ жизни списывается втрое чаще, чем приходят дивиденды, и это
// намеренно — содержание должно ощущаться, а не теряться на фоне купонов.
export const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
export interface GameState {
  account: Account;
  // Текущий режим рынка. Считается на сервере: таймлайн общий для всех.
  marketRegime: MarketRegime;
  prices: Record<string, number>;
  candles: Record<string, Candle[]>;
  activeAssets: Asset[];
  activeStyle: TradingStyleConfig;
  gameCalendarDay: number;
  gameElapsedMs: number; // накоплено игрового времени с начала партии
  lastDividendQuarter: number; // номер последнего игрового квартала, за который уже заплатили
  lifestyle: LifestyleState; // покупки/косметика — раздел 13
  lastUpkeepMonth: number; // номер последнего игрового месяца, за который уже списали содержание
  // Эквити на начало текущего игрового дня — из неё считается дневной
  // результат в шапке терминала. Хранить историю эквити ради одной цифры
  // было бы дороже: снимок обновляется раз в игровой день.
  dayStartEquity: number;
  // Лента новостей общего мира — её приносит стор вместе с котировками.
  newsFeed: NewsEvent[];
  // Изменение за день по инструментам (для скринера) — тоже из котировок.
  dayChange: Record<string, number>;
  // Настройки баланса из админки. Живут в состоянии, а не в модульной
  // переменной движка: формулы обязаны оставаться чистыми и тестируемыми
  // (раздел 26 — никакого скрытого глобального состояния).
  tuning: GameTuning;
  // Прогрессия: контракты (цели), перки (во что тратится опыт), очки за
  // пройденные контракты и открытые рынки.
  contracts: ContractState;
  perks: PerkState;
  contractPoints: number;
  unlockedMarkets: AssetClass[];
  // Последний завершившийся контракт — UI показывает по нему уведомление и
  // сбрасывает поле, чтобы не показать дважды.
  lastContractResult: ContractRecord | null;
  // Ежедневные задания и последняя порция выполненных — UI показывает по ней
  // уведомление и очищает поле.
  daily: DailyState;
  lastDailyCompleted: DailyTask[];
  bots: AlgoBot[];
  drawings: Record<string, GameDrawing[]>;
  // Договор со спонсором после разорения: пока он жив, доля прибыли уходит
  // не игроку. null — игрок никому не должен.
  sponsor: SponsorDeal | null;
  // Счёт разорён и спонсор ещё не предложен: UI показывает по этому флагу
  // предложение и гасит его, когда игрок ответил.
  wipedOut: boolean;
}

/**
 * Возвращает цену исполнения, если SL/TP сработал, иначе null. Проверяем SL
 * первым: если оба условия истинны в один тик (гэп больше расстояния между
 * ними), консервативнее закрыть по стопу, а не по тейку.
 */
export function checkStopConditions(position: Position, currentPrice: number): number | null {
  const { side, stopLoss, takeProfit } = position;
  if (side === "long") {
    if (stopLoss != null && currentPrice <= stopLoss) return stopLoss;
    if (takeProfit != null && currentPrice >= takeProfit) return takeProfit;
  } else {
    if (stopLoss != null && currentPrice >= stopLoss) return stopLoss;
    if (takeProfit != null && currentPrice <= takeProfit) return takeProfit;
  }
  return null;
}

/**
 * Открывает позицию на счёте: резервирует маржу и кладёт позицию в список.
 * Общая функция для ручного ордера из UI (gameStore.openPosition) и для
 * алго-ботов — чтобы резерв маржи считался ОДИНАКОВО. Расхождение здесь
 * означало бы, что закрытие возвращает не ту сумму, которую сняло открытие,
 * то есть дырку в балансе.
 *
 * Мутирует account. Возвращает открытую позицию.
 */
export function applyPositionOpen(
  account: Account,
  input: {
    assetId: string;
    side: Position["side"];
    size: number;
    leverage: number;
    entryPrice: number;
    stopLoss?: number;
    takeProfit?: number;
    trailingPct?: number;
    style: Position["style"];
  },
): Position {
  const entryPrice = applySlippage(input.entryPrice, input.side, true, account.psychology.stress);
  const position: Position = {
    id: crypto.randomUUID(),
    assetId: input.assetId,
    side: input.side,
    entryPrice,
    size: input.size,
    leverage: input.leverage,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    trailingPct: input.trailingPct,
    openedAt: Date.now(),
    fees: 0, // считается при закрытии — см. pnlCalculator.settleClose
    style: input.style,
  };
  account.balance -= calculateRequiredMargin(entryPrice, input.size, input.leverage);
  account.positions.push(position);
  return position;
}

/**
 * Закрывает позицию по заданной цене и применяет эффект к счёту: баланс,
 * журнал, прогрессию (XP/уровень навыка по стилю, раздел 4.5). Общая
 * функция для ликвидации и авто-закрытия по SL/TP (ниже, шаг 4) и ручного
 * закрытия из UI (gameStore.ts) — чтобы все три пути считали комиссию,
 * R-мультипликатор и опыт одинаково. Мутирует переданный account (вызывающий
 * код передаёт уже скопированный черновик), возвращает realizedPnl.
 *
 * extraFee — доп. штраф поверх обычной комиссии (calculateLiquidationPenalty
 * при принудительном закрытии по марже; 0 при обычном закрытии). spreadCost
 * из раздела 4.1 сюда же не добавлен отдельно: Asset (раздел 2) не задаёт
 * базовый bid/ask спред по инструменту — ADJUSTED FROM SPEC.
 */
export function applyPositionClose(
  account: Account,
  position: Position,
  exitPrice: number,
  commissionRate: number,
  extraFee = 0,
  xpMultiplier = 1,
  gameDay = 0,
  closeSize?: number,
): number {
  // Частичное закрытие: считаем всё по «ломтю» позиции, а остаток оставляем
  // открытым с той же ценой входа. Зафиксировать половину и перевести остаток
  // в безубыток — базовое движение сопровождения сделки, и без него не
  // работает ни одна нормальная стратегия выхода.
  const size = closeSize != null ? Math.min(Math.max(0, closeSize), position.size) : position.size;
  if (!(size > 0)) return 0;
  const partial = size < position.size;
  const slice: Position = partial ? { ...position, size } : position;
  const requiredMargin = calculateRequiredMargin(slice.entryPrice, slice.size, slice.leverage);
  // Стресс портит исполнение — нервный трейдер жмёт кнопку хуже. Эффект
  // всегда НЕ в пользу игрока и предсказуем по величине (см. psychology.ts).
  const filled = applySlippage(exitPrice, position.side, false, account.psychology.stress);
  const { realizedPnl } = settleClose(slice, filled, commissionRate, extraFee);
  // requiredMargin — тот же резерв, что openPosition() в gameStore.ts снял с
  // баланса при открытии (раздел 4.2; при leverage=1 совпадает с полным
  // номиналом — старое поведение Фазы 1 не меняется).
  account.balance += requiredMargin + realizedPnl;

  const rMultiple =
    position.stopLoss != null
      ? realizedPnl / (Math.abs(slice.entryPrice - slice.stopLoss!) * slice.size * slice.leverage)
      : 0;

  account.journal.push({
    id: crypto.randomUUID(),
    positionId: position.id,
    timestampClosed: Date.now(),
    // Игровой день нужен дневным заданиям: реальное время для них не годится
    // (на investing игровой день проходит за секунды).
    gameDay,
    pnl: realizedPnl,
    rMultiple,
    tags: [],
  });

  // Прогрессия (раздел 4.5) — начисляется на КАЖДОЙ закрытой сделке,
  // независимо от результата (даже убыточная по плану чему-то учит).
  const style = slice.style;
  const current = account.skills[style] ?? { level: 0, xp: 0, xpToNextLevel: xpToNextLevel(0) };
  account.skills[style] = applyXpGain(current, calculateXpGain(BASE_XP, rMultiple, style) * xpMultiplier);

  const idx = account.positions.findIndex((p) => p.id === position.id);
  account.psychology = applyTradeOutcome(account.psychology, {
    pnl: realizedPnl,
    hadStop: position.stopLoss != null,
    leverage: position.leverage,
    liquidated: extraFee > 0, // штраф сверх комиссии бывает только при ликвидации
  });

  const closed: Position = {
    ...slice,
    // У частичного закрытия свой id: иначе две записи об одной позиции —
    // открытый остаток и закрытый ломоть — столкнулись бы ключами в списке.
    id: partial ? crypto.randomUUID() : slice.id,
    closedAt: Date.now(),
    closePrice: exitPrice,
    realizedPnl,
  };
  if (partial) {
    if (idx >= 0) account.positions[idx] = { ...position, size: position.size - size };
    account.positions.push(closed);
  } else if (idx >= 0) {
    account.positions[idx] = closed;
  }
  return realizedPnl;
}

function recalculateAccountMetrics(account: Account, prices: Record<string, number>): void {
  let unrealizedTotal = 0;
  let marginUsed = 0;
  for (const p of account.positions) {
    // account.positions хранит и закрытые сделки (для истории в UI) — без
    // этого фильтра их entryPrice продолжал бы сравниваться с текущей ценой
    // вечно, и equity «плыла» бы от баланса даже без единой открытой позиции.
    if (p.closedAt != null) continue;
    const price = prices[p.assetId];
    if (price != null) unrealizedTotal += calculateUnrealizedPnl(p, price);
    marginUsed += calculateRequiredMargin(p.entryPrice, p.size, p.leverage);
  }
  account.equity = account.balance + unrealizedTotal;
  account.marginUsed = marginUsed;
  account.marginLevel = calculateMarginLevel(account.equity, marginUsed);
}

/**
 * Главный тик. dtRealMs — сколько реального времени прошло с прошлого
 * вызова. Источник случайности больше не нужен: всё случайное (цены,
 * новости, режимы) считает сервер.
 *
 * Шаги псевдокода раздела 11 реализованы полностью, кроме психологии
 * (раздел 4.4) — она остаётся заготовкой типов до своей фазы.
 */
export function gameTick(dtRealMs: number, state: GameState): GameState {
  const tuning = state.tuning ?? DEFAULT_TUNING;
  const perks = perkEffects(state.perks);
  // Перки складываются с настройками админки, а не заменяют их: админ задаёт
  // «мир», перк — личное преимущество игрока внутри этого мира.
  const xpMultiplier = tuning.xpMultiplier * perks.xpMultiplier;
  const maintenanceRate = DEFAULT_MAINTENANCE_MARGIN_RATE * (perks.marginMultiplier - perks.liquidationBuffer);
  const dtGameMs = dtRealMs * state.activeStyle.timeAcceleration;
  const gameElapsedMs = state.gameElapsedMs + dtGameMs;

  // Цены приходят с сервера — стор обновил их перед тиком.
  const prices = state.prices;
  const candles = state.candles;

  // Ликвидация — ПЕРВОЙ и вместо SL/TP на этом тике: реальная биржа закрыла
  // бы позицию принудительно раньше, чем добралась бы очередь до "мягкого"
  // стопа (edge case раздела 26 про приоритет форс-закрытия).
  const account: Account = {
    ...state.account,
    positions: [...state.account.positions],
    journal: [...state.account.journal],
    pendingOrders: [...(state.account.pendingOrders ?? [])],
  };

  // 3. Отложенные ордера — ДО проверки стопов: заявка, сработавшая на этом
  // тике, должна тем же тиком получить право быть закрытой по своему стопу.
  // Иначе гэп выходного дня, который и открывает позицию, и пробивает её
  // стоп, оставил бы игрока в убытке, от которого он как раз защищался.
  const stillPending: Order[] = [];
  for (const order of account.pendingOrders) {
    if (order.status !== "pending") continue;
    const price = prices[order.assetId];
    if (price == null) {
      stillPending.push(order);
      continue;
    }
    if (order.expiresAt != null && Date.now() >= order.expiresAt) continue; // протух — молча снимаем
    const orderAsset = state.activeAssets.find((a) => a.id === order.assetId);
    if (orderAsset && !isMarketOpen(orderAsset.assetClass, Date.now())) {
      // Закрытый рынок заявку не исполняет, но и не отменяет: она для того и
      // ставилась, чтобы дождаться открытия.
      stillPending.push(order);
      continue;
    }
    if (!orderTriggers(order, price)) {
      stillPending.push(order);
      continue;
    }
    const leverage = order.leverage ?? 1;
    // Цена исполнения — уровень ордера, а не текущая цена: заявка стоит на
    // уровне и берётся с него.
    const fillPrice = triggerLevel(order) ?? price;
    const cost = calculateRequiredMargin(fillPrice, order.size, leverage);
    if (cost > account.balance) continue; // денег к моменту срабатывания не осталось — заявка сгорает
    applyPositionOpen(account, {
      assetId: order.assetId,
      side: order.side,
      size: order.size,
      leverage,
      entryPrice: fillPrice,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      trailingPct: order.trailingPct,
      style: order.style ?? state.activeStyle.style,
    });
  }
  account.pendingOrders = stillPending;

  // 4. Проверить ликвидацию и SL/TP.
  for (const position of [...account.positions]) {
    if (position.closedAt) continue;
    const price = prices[position.assetId];
    if (price == null) continue;

    // Скользящий стоп подтягивается перед проверкой: на резком движении
    // внутри одного тика он обязан успеть зафиксировать прибыль.
    if (position.trailingPct != null) {
      const moved = trailStop(position.side, price, position.trailingPct, position.stopLoss);
      if (moved != null) {
        position.stopLoss = moved;
        const at = account.positions.findIndex((p) => p.id === position.id);
        if (at >= 0) account.positions[at] = { ...position, stopLoss: moved };
      }
    }
    // Комиссия — по стилю, под которым позиция была ОТКРЫТА, а не по
    // текущему активному стилю: игрок мог переключиться (Фаза 2 добавила
    // смену стиля на лету), и позиция от scalping не должна вдруг закрыться
    // по тарифу swing только потому, что игрок сейчас смотрит другой режим.
    const commissionRate = TRADING_STYLE_CONFIGS[position.style].commissionRate;

    if (checkLiquidation(position, price, maintenanceRate)) {
      const penalty = calculateLiquidationPenalty(position.entryPrice, position.size);
      const liqPriceAdjusted = calculateLiquidationPrice(position.entryPrice, position.leverage, position.side, maintenanceRate);
      applyPositionClose(
        account,
        position,
        liqPriceAdjusted,
        commissionRate * perks.commissionMultiplier,
        penalty,
        xpMultiplier,
        state.gameCalendarDay,
      );
      continue;
    }

    const exitPrice = checkStopConditions(position, price);
    if (exitPrice == null) continue;
    applyPositionClose(account, position, exitPrice, commissionRate * perks.commissionMultiplier, 0, xpMultiplier, state.gameCalendarDay);
  }

  // 6. Дивиденды/купоны раз в неделю (раздел 4.6) — платим за КАЖДЫЙ
  // пройденный период, а не только за факт «неделя наступила»: один шаг
  // офлайн-прогресса может перескочить сразу несколько недель, и пропускать
  // промежуточные выплаты было бы нечестно по отношению к формуле (игрок
  // реально столько держал позицию).
  const currentQuarter = Math.floor(gameElapsedMs / DIVIDEND_PERIOD_MS);
  let lastDividendQuarter = state.lastDividendQuarter;
  while (lastDividendQuarter < currentQuarter) {
    lastDividendQuarter++;
    processQuarterlyDividends(account, state.activeAssets, prices, tuning.dividendMultiplier * perks.dividendMultiplier);
  }

  // 6b. Расход на образ жизни раз в игровой месяц (раздел 13) — зеркально
  // дивидендам выше: тот же приём "платим за каждый пройденный период", чтобы
  // один тик на ускорении investing (43200x) не проглатывал месяцы бесплатно.
  const currentMonth = Math.floor(gameElapsedMs / MONTH_MS);
  let lastUpkeepMonth = state.lastUpkeepMonth;
  let lifestyle = state.lifestyle;
  const upkeep = monthlyUpkeep(lifestyle) * tuning.upkeepMultiplier * perks.upkeepMultiplier;
  while (lastUpkeepMonth < currentMonth) {
    lastUpkeepMonth++;
    if (upkeep > 0) lifestyle = chargeUpkeep(account, lifestyle, upkeep).lifestyle;
  }

  // 7. Пересчитать equity/marginLevel (после дивидендов — они меняют balance).
  recalculateAccountMetrics(account, prices);

  // 8. Контракт (цель игрока) — проверяется каждый тик по свежей эквити.
  const gameCalendarDay = Math.floor(gameElapsedMs / (24 * 60 * 60 * 1000));
  const evaluation = evaluateContract(state.contracts, account.equity, gameCalendarDay);
  let contractPoints = state.contractPoints;
  let unlockedMarkets = state.unlockedMarkets;
  if (evaluation.finished?.outcome === "passed") {
    const contract = getContract(evaluation.finished.contractId);
    if (contract) {
      applyContractReward(account, contract);
      contractPoints += contract.reward.skillPoints;
      // Новые рынки — главная награда: 41 инструмент лежит в assets.json и
      // ждёт разблокировки, это готовый контент, а не новая разработка.
      const merged = new Set<AssetClass>([...unlockedMarkets, ...contract.reward.unlockMarkets]);
      unlockedMarkets = Array.from(merged);
      // Награда меняет баланс — пересчитываем метрики ещё раз, иначе эквити
      // на этом кадре покажет старое значение.
      recalculateAccountMetrics(account, prices);
    }
  }

  // 8a. Психология: стресс сходит со временем, а купленный отдых ускоряет
  // это. Считается от игрового времени, а не от реального: на investing
  // «неделя отдыха» проходит за секунды, и это правильно — там и торговый
  // день короче.
  account.psychology = recoverOverTime(account.psychology, dtGameMs, restFactor(lifestyle));

  // 8b. Алго-боты (ветка перков «Автоматика»). Работают только в пределах
  // купленных слотов: лишние боты в сохранении молча игнорируются, а не
  // торгуют бесплатно.
  const slots = botSlots(state.perks?.unlocked ?? []);
  if (slots > 0) {
    for (const bot of (state.bots ?? []).slice(0, slots)) {
      if (!bot.enabled) continue;
      const price = prices[bot.assetId];
      if (price == null) continue;
      if (botHasPosition(bot, account.positions)) continue;
      const side = botSignal(bot, candles[bot.assetId] ?? [], price);
      if (!side) continue;
      const size = botPositionSize(account.balance, price, bot);
      const cost = calculateRequiredMargin(price, size, 1);
      // Бот не влезает в долги и не съедает баланс целиком: половина
      // свободных денег — жёсткий предел на одну автоматическую сделку.
      if (!(size > 0) || cost > account.balance * 0.5) continue;
      applyPositionOpen(account, {
        assetId: bot.assetId,
        side,
        size,
        leverage: 1,
        entryPrice: price,
        stopLoss: botStopLoss(price, side, bot),
        takeProfit: botTakeProfit(price, side, bot),
        style: state.activeStyle.style,
      });
    }
    recalculateAccountMetrics(account, prices);
  }

  // 9. Ежедневные задания: считаются от журнала и позиций, отдельных
  // счётчиков не заводим — меньше состояния, нечему рассинхронизироваться.
  const dailyResult = evaluateDaily(state.daily ?? freshDailyState(), {
    day: gameCalendarDay,
    journal: account.journal,
    positions: account.positions,
    assets: state.activeAssets,
    dayStartEquity: state.dayStartEquity,
    equity: account.equity,
  });
  if (dailyResult.rewardCash > 0) {
    account.balance += dailyResult.rewardCash;
    const style = state.activeStyle.style;
    const current = account.skills[style] ?? { level: 0, xp: 0, xpToNextLevel: xpToNextLevel(0) };
    account.skills[style] = applyXpGain(current, dailyResult.rewardXp * xpMultiplier);
    recalculateAccountMetrics(account, prices);
  }

  // Доля спонсора. Считается по журналу, а не в момент закрытия позиции:
  // закрывают её три разных пути (стоп, ликвидация, рука игрока), и только
  // журнал видит все три одинаково. Счётчик учтённых сделок в договоре не
  // даёт одной сделке заплатить долю дважды.
  let sponsor = state.sponsor;
  if (sponsor) {
    const fresh = account.journal.slice(sponsor.settledTrades);
    if (fresh.length > 0) {
      let cut = 0;
      for (const entry of fresh) cut += sponsorCut(sponsor, entry.pnl);
      account.balance -= cut;
      sponsor = applySponsorCut(sponsor, cut, account.journal.length);
      recalculateAccountMetrics(account, prices);
    }
  }

  // Разорение: денег почти нет и закрывать больше нечего. Флаг поднимается
  // один раз — гасит его UI, когда игрок ответит на предложение спонсора.
  const wipedOut =
    state.wipedOut || (sponsor == null && isWipedOut(account.equity, account.positions, tuning.startingBalance));

  // 10. Смена игрового дня — фиксируем эквити для дневного результата.
  const dayStartEquity =
    gameCalendarDay !== state.gameCalendarDay || state.dayStartEquity == null
      ? account.equity
      : state.dayStartEquity;

  return {
    ...state,
    prices,
    candles,
    account,
    gameElapsedMs,
    gameCalendarDay,
    dayStartEquity,
    contracts: evaluation.state,
    contractPoints,
    unlockedMarkets,
    lastContractResult: evaluation.finished ?? state.lastContractResult,
    daily: dailyResult.state,
    lastDailyCompleted: dailyResult.completed.length > 0 ? dailyResult.completed : state.lastDailyCompleted,
    lastDividendQuarter,
    lifestyle,
    lastUpkeepMonth,
    sponsor,
    wipedOut,
  };
}
