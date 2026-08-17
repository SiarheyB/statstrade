/**
 * recompute.ts — пересчёт "картины дня" (LevelSetup) для всех пар, по
 * которым коллектор насканил дневные свечи (см. TRADE_RECOMMENDATIONS_PLAN.md,
 * п.4-5). Truncate + refill: таблица не история, а срез "на сегодня".
 */

import { prisma } from "@/lib/db";
import { getFeatureConfig } from "@/lib/featureConfig";
import { detectLevels, filterLevelsNearPrice, computeAtr, detectTrend, type DailyCandle } from "./levels";
import { computeBreakoutSignals } from "./breakoutSignals";
import {
  assessLevelQuality,
  passesQualityGate,
  qualityScore,
  serializeQuality,
  DEFAULT_THRESHOLDS,
  LOCAL_THRESHOLDS,
  type LevelQuality,
} from "./quality";

const EXCHANGE = "binance-futures";
const INTERVAL = "1d";
const MIN_CANDLES = 20;
// Глубина истории на инструмент: хватает на «экстремум за 6 месяцев» (126
// баров) в детекторе уровней плюс запас на окна качества/ATR.
const CANDLE_DEPTH = 300;
const DAY_MS = 86_400_000;
// Сила уровня, начиная с которой он считается «значимым» и учитывается как
// препятствие в запасе хода (см. quality.ts, runwayAtr).
const SIGNIFICANT_LEVEL_STRENGTH = 3;

export interface RecomputeResult {
  symbolsScanned: number;
  levelsWritten: number;
  /** Сколько уровней отброшено как нейтральные (в БД они не попадают). */
  neutralSkipped: number;
  /** Сколько уровней прошло фильтр качества до отсечения по лимиту выдачи. */
  candidates: number;
  /** Сколько отсеяно фильтром качества, с разбивкой по причинам. */
  rejected: Record<string, number>;
}

// Колбэки прогресса для админского прогресс-бара (см. progress.ts). Все
// опциональны — cron-путь вызывает пересчёт вообще без них.
export interface RecomputeCallbacks {
  onSymbolsListed?: (total: number) => void;
  onSymbolStart?: (symbol: string, index: number) => void;
  onSymbolDone?: (symbol: string, index: number, levelsSoFar: number) => void;
  onWriteStart?: () => void;
}

/**
 * Из нескольких сетапов по одному инструменту оставляет сильнейший — с
 * наибольшим score. Экспортируется ради теста: правило «один инструмент —
 * один сетап» важнее, чем деталь реализации отбора.
 */
export function pickStrongestPerSymbol<T extends { symbol: string; score: number }>(rows: T[]): Map<string, T> {
  const best = new Map<string, T>();
  for (const row of rows) {
    const prev = best.get(row.symbol);
    if (!prev || row.score > prev.score) best.set(row.symbol, row);
  }
  return best;
}

// Все символы, по которым в ObCandle есть хотя бы одна 1d-свеча на этой бирже.
async function listCandidateSymbols(): Promise<string[]> {
  const rows = await prisma.obCandle.findMany({
    where: { exchange: EXCHANGE, interval: INTERVAL },
    distinct: ["symbol"],
    select: { symbol: true },
  });
  return rows.map((r) => r.symbol);
}

// Последние CANDLE_DEPTH дневных свечей. Сортировка ОБЯЗАТЕЛЬНО по убыванию:
// с `orderBy: asc` + `take` база отдаёт самые СТАРЫЕ свечи, и анализ считался
// бы по позапрошлым месяцам (а «текущей ценой» было бы закрытие того дня).
// Разворачиваем обратно в хронологический порядок — его ждут все детекторы.
async function loadCandles(symbol: string, now = Date.now()): Promise<DailyCandle[]> {
  const rows = await prisma.obCandle.findMany({
    where: { symbol, exchange: EXCHANGE, interval: INTERVAL },
    orderBy: { t: "desc" },
    take: CANDLE_DEPTH,
  });
  return dropUnclosedBar(
    rows.reverse().map((r) => ({ t: r.t.getTime(), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v })),
    now,
  );
}

/**
 * Убирает последний бар, если его сутки ещё не закончились.
 *
 * `t` — время ОТКРЫТИЯ дневной свечи (00:00 UTC), и коллектор обновляет её
 * весь день. Анализировать такой бар нельзя: весь фильтр качества трактует
 * последний бар как «вчерашний закрытый день» («закрытие вплотную к уровню»,
 * размер баров подхода, ATR), а сразу после полуночи у формирующегося бара
 * o≈h≈l≈c и почти нулевой диапазон — метрики были бы мусором.
 */
export function dropUnclosedBar(candles: DailyCandle[], now = Date.now()): DailyCandle[] {
  const last = candles[candles.length - 1];
  if (!last) return candles;
  const closesAt = last.t + DAY_MS;
  return closesAt > now ? candles.slice(0, -1) : candles;
}

export async function recomputeRecommendations(cb: RecomputeCallbacks = {}): Promise<RecomputeResult> {
  const feature = await getFeatureConfig("tradeRecommendations");
  const maxDistanceAtr = feature.maxDistanceAtr;
  const symbols = await listCandidateSymbols();
  cb.onSymbolsListed?.(symbols.length);
  let neutralSkipped = 0;
  const rejected: Record<string, number> = {};
  const rows: {
    symbol: string;
    exchange: string;
    levelPrice: number;
    levelType: string;
    strength: number;
    distanceAtr: number;
    bias: string;
    direction: string;
    signals: { for: string[]; against: string[] };
    bsuAt: Date;
    quality: LevelQuality;
    score: number;
    atr: number;
    currentPrice: number;
    candlesFrom: Date;
    candlesTo: Date;
    lastVolume: number | null;
  }[] = [];

  for (const [index, symbol] of symbols.entries()) {
    cb.onSymbolStart?.(symbol, index);
    const candles = await loadCandles(symbol);
    if (candles.length < MIN_CANDLES) {
      cb.onSymbolDone?.(symbol, index, rows.length);
      continue;
    }

    const atr = computeAtr(candles);
    if (atr <= 0) {
      cb.onSymbolDone?.(symbol, index, rows.length);
      continue;
    }
    const currentPrice = candles[candles.length - 1].c;
    const candlesFrom = new Date(candles[0].t);
    const candlesTo = new Date(candles[candles.length - 1].t);

    const levels = detectLevels(candles);
    const nearby = filterLevelsNearPrice(levels, currentPrice, atr, maxDistanceAtr);
    const trend = detectTrend(candles);

    // Запас хода считаем только до ЗНАЧИМЫХ уровней: детектор находит их
    // десятками на инструмент, и по всем подряд «следующий уровень» всегда
    // оказывался бы вплотную.
    const significantLevels = levels.filter((l) => l.strength >= SIGNIFICANT_LEVEL_STRENGTH).map((l) => l.price);

    for (const level of nearby) {
      const signals = computeBreakoutSignals(candles, level.price, atr);
      // Нейтральные сетапы (факторов "за" и "против" поровну) не сохраняем:
      // торговать по ним нечего, а в списке они только шумят.
      if (signals.bias === "neutral" || !signals.direction) {
        neutralSkipped += 1;
        continue;
      }

      // ЛП торгуем только ПО тренду (конспект: "Ліпше працювати ЛП по
      // тренду") — в нисходящем тренде это шорт от уровня сверху (более
      // ранний откат слева), в восходящем — лонг от уровня снизу.
      // Контр-трендовые ЛП (например "ЛП в лонг" посреди сильного падения)
      // не доходят даже до фильтра качества. При "range" (тренд не читается)
      // это правило не применяем вовсе — старое поведение как fallback.
      if (signals.bias === "false_breakout" && trend !== "range") {
        const trendDirection = trend === "down" ? "short" : "long";
        if (signals.direction !== trendDirection) {
          rejected.counter_trend = (rejected.counter_trend ?? 0) + 1;
          continue;
        }
        // Источник уровня — только настоящий прошлый откат структуры
        // ("слева ищем другие откаты"), а не любой близкий уровень.
        if (level.type !== "retracement" && level.type !== "structure_break") {
          rejected.not_retracement_source = (rejected.not_retracement_source ?? 0) + 1;
          continue;
        }
        // Дальний ретест: последнее касание уровня — не раньше 10 дней назад.
        const daysSinceTouch = (candlesTo.getTime() - level.lastTouchedAt) / DAY_MS;
        if (daysSinceTouch < 10) {
          rejected.retest_too_recent = (rejected.retest_too_recent ?? 0) + 1;
          continue;
        }
      }

      // Фильтр качества: уровень без запилов, с пустотой за ним, к которому
      // вчерашний день подошёл вплотную (см. quality.ts). Для local_stop —
      // облегчённые окна (LOCAL_THRESHOLDS): уровню несколько дней, а не
      // месяцы, и полная история просто нерелевантна для него.
      const thresholds = level.type === "local_stop" ? LOCAL_THRESHOLDS : DEFAULT_THRESHOLDS;
      const quality = assessLevelQuality(
        candles,
        level.price,
        atr,
        currentPrice,
        significantLevels.filter((p) => p !== level.price),
        thresholds,
      );
      const gate = passesQualityGate(quality, signals.bias, { for: signals.for, against: signals.against }, thresholds);
      if (!gate.ok) {
        for (const reason of gate.rejectedBy) rejected[reason] = (rejected[reason] ?? 0) + 1;
        continue;
      }

      rows.push({
        symbol,
        exchange: EXCHANGE,
        levelPrice: level.price,
        levelType: level.type,
        strength: level.strength,
        distanceAtr: Math.abs(level.price - currentPrice) / atr,
        bias: signals.bias,
        direction: signals.direction,
        signals: { for: signals.for, against: signals.against },
        // БСУ — бар, на котором уровень образовался; по нему в карточке
        // ставится стрелка и подпись с датой.
        bsuAt: new Date(level.formedAt),
        quality,
        score: qualityScore(quality, level.strength, signals.bias),
        atr,
        currentPrice,
        candlesFrom,
        candlesTo,
        // В долларах (объём в базовом активе × цена закрытия), а не в штуках
        // токена — так число хоть в общем порядке сопоставимо с $-объёмом,
        // который показывают биржевые виджеты (хотя те агрегируют несколько
        // бирж, а здесь только Binance USDT-M).
        lastVolume: candles[candles.length - 1].v != null ? candles[candles.length - 1].v! * currentPrice : null,
      });
    }
    cb.onSymbolDone?.(symbol, index, rows.length);
  }

  cb.onWriteStart?.();

  // Один инструмент — один сетап. Рядом с ценой у пары обычно несколько
  // уровней, и один и тот же инструмент мог бы попасть в список дважды, ещё и
  // в противоположных сторонах (пробой в лонг и ложный пробой в шорт). Это
  // бессмысленно для торговли, поэтому оставляем ровно один — с наибольшим
  // score, то есть самый чистый и близкий (см. qualityScore в quality.ts).
  // Число инструментов не ограничиваем: сколько нашлось готовых — столько и
  // показываем, отбор делает фильтр качества, а не лимит выдачи.
  const selected = [...pickStrongestPerSymbol(rows).values()].sort((a, b) => b.score - a.score);

  await prisma.$transaction([
    prisma.levelSetup.deleteMany({}),
    ...(selected.length > 0
      ? [
          prisma.levelSetup.createMany({
            data: selected.map((r) => ({ ...r, signals: r.signals, quality: serializeQuality(r.quality) })),
          }),
        ]
      : []),
  ]);

  return {
    symbolsScanned: symbols.length,
    levelsWritten: selected.length,
    neutralSkipped,
    candidates: rows.length,
    rejected,
  };
}
