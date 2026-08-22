/**
 * recompute.ts — пересчёт "картины дня" (LevelSetup) для всех пар, по
 * которым коллектор насканил дневные свечи (см. TRADE_RECOMMENDATIONS_PLAN.md,
 * п.4-5). Truncate + refill: таблица не история, а срез "на сегодня".
 */

import { prisma } from "@/lib/db";
import { getFeatureConfig } from "@/lib/featureConfig";
import { detectLevels, filterLevelsNearPrice, computeAtr, detectTrend, type DailyCandle } from "./levels";
import { computeBreakoutSignals } from "./breakoutSignals";
import { detectFalseBreakout2b } from "./falseBreakout2b";
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
// баров) в детекторе уровней плюс запас на окна качества/ATR. Сами уровни
// ищутся только в последних ~180 барах (окно свежести в levels.ts) — эта
// история нужна разбору качества (запилы, ложные пробои слева), а не поиску
// линий.
const CANDLE_DEPTH = 300;
const DAY_MS = 86_400_000;
// Сила уровня, начиная с которой он считается «значимым» и учитывается как
// препятствие в запасе хода (см. quality.ts, runwayAtr).
const SIGNIFICANT_LEVEL_STRENGTH = 3;
// Порог ликвидности: инструменты, у которых дневной оборот меньше $1 млн, в
// выдачу не идут вовсе. На таком стакане вход и выход сами двигают цену, и
// разница между расчётным и реальным исполнением съедает весь сетап.
const MIN_DAILY_VOLUME_USD = 1_000_000;
// Типы уровней, от которых имеет смысл ЛП2Б (см. комментарий у suitable2bLevel).
// "historical" из списка убран намеренно: это метка «старый уровень, ещё не
// переподтверждённый» — работаем только по уровням, которые рынок уважает
// сейчас.
const LEVEL_TYPES_2B = new Set(["retracement", "structure_break", "break_point", "mirror"]);

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
  // groupBy, а не distinct: Prisma-шный distinct дедуплицирует в памяти, то
  // есть тянет из базы все дневные свечи (сотни тысяч строк) ради списка из
  // нескольких сотен символов.
  const rows = await prisma.obCandle.groupBy({
    by: ["symbol"],
    where: { exchange: EXCHANGE, interval: INTERVAL },
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
    returnMoveAtr: number | null;
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
    // Отсекаем тонкие инструменты до анализа: считать по ним уровни незачем,
    // а пересчёт идёт по всем 700 парам биржи.
    const lastVolumeUsd = candles[candles.length - 1].v != null ? candles[candles.length - 1].v! * currentPrice : null;
    if (lastVolumeUsd != null && lastVolumeUsd < MIN_DAILY_VOLUME_USD) {
      rejected.thin_volume = (rejected.thin_volume ?? 0) + 1;
      cb.onSymbolDone?.(symbol, index, rows.length);
      continue;
    }
    const candlesFrom = new Date(candles[0].t);
    const candlesTo = new Date(candles[candles.length - 1].t);

    const levels = detectLevels(candles);
    // Последний закрытый бар — точка отсчёта «близости»: важно, докуда цена
    // дотянулась вчера, а не где закрылась (см. filterLevelsNearPrice).
    const nearby = filterLevelsNearPrice(levels, currentPrice, atr, maxDistanceAtr, candles[candles.length - 1]);
    const trend = detectTrend(candles);

    // Запас хода считаем только до ЗНАЧИМЫХ уровней: детектор находит их
    // десятками на инструмент, и по всем подряд «следующий уровень» всегда
    // оказывался бы вплотную.
    const significantLevels = levels.filter((l) => l.strength >= SIGNIFICANT_LEVEL_STRENGTH).map((l) => l.price);

    for (const level of nearby) {
      // ЛП2Б проверяем ПЕРВЫМ и отдельной веткой: у него всё зеркально
      // обычному разбору. Цена уже по другую сторону уровня, поэтому и bias
      // по голосованию факторов, и требования гейта к подходу здесь не
      // работают — сетап целиком описывается detectFalseBreakout2b.
      // Разворот против свежего импульса имеет смысл только от уровня, который
      // рынок реально уважает: на живой выдаче уровни силы 2 давали половину
      // всех 2Б и были заметно слабее остальных по всем метрикам.
      //
      // Тип уровня для 2Б ограничен структурными: сетап требует ДАЛЬНЕГО
      // ретеста, а local_stop («локальная опорная точка») по построению живёт
      // несколько дней — «давно не тронутым» он быть не может, и его линия
      // проводится по свежему локальному экстремуму, а не по уважаемому
      // рынком уровню. Границы гэпов сюда же: касаний, которые делают уровень
      // уровнем, у них нет.
      const suitable2bLevel = LEVEL_TYPES_2B.has(level.type) && level.strength >= SIGNIFICANT_LEVEL_STRENGTH;
      const setup2b = suitable2bLevel ? detectFalseBreakout2b(candles, level.price, atr) : null;
      const signals = setup2b
        ? {
            for: ["false_breakout_2b", "fast_approach_2b", "far_retest_2b"],
            against: [],
            bias: "false_breakout_2b" as const,
            direction: setup2b.direction,
          }
        : computeBreakoutSignals(candles, level.price, atr, level.type, level.formedAt);
      // Нейтральные сетапы (факторов "за" и "против" поровну) не сохраняем:
      // торговать по ним нечего, а в списке они только шумят.
      if (signals.bias === "neutral" || !signals.direction) {
        neutralSkipped += 1;
        continue;
      }

      // Торгуем только ПО тренду — и ЛП, и пробой (конспект: "Ліпше
      // працювати ЛП по тренду"; для пробоя требование тем более верно —
      // пробой уровня против направления рынка это и есть та сделка, от
      // которой алгоритм отговаривает). Раньше правило применялось только к
      // ЛП, и в выдачу попадал, например, "пробой в лонг" у пары, падающей
      // третий месяц подряд. При "range" (тренд не читается) правило не
      // применяем вовсе — старое поведение как fallback.
      // ЛП2Б исключён намеренно: он по определению идёт ПРОТИВ только что
      // случившегося импульса (пробили вверх — работаем вниз), и фильтр «по
      // тренду» отбрасывал бы ровно те сетапы, ради которых он добавлен.
      // Защита от «ловли ножей» здесь другая — сам детектор требует закрытие
      // впритык к уровню и дальний ретест.
      if (trend !== "range" && signals.bias !== "false_breakout_2b") {
        const trendDirection = trend === "down" ? "short" : "long";
        if (signals.direction !== trendDirection) {
          rejected.counter_trend = (rejected.counter_trend ?? 0) + 1;
          continue;
        }
      }

      if (signals.bias === "false_breakout" && trend !== "range") {
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
        // Именно firstFormedAt: «уровень уже сняли» меряется от самого первого
        // появления линии, иначе свежая переотработка той же цены обнуляла бы
        // память о том, что цена за неё уже уходила.
        level.firstFormedAt,
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
        // Для 2Б расстояние до уровня — не «сколько идти», а «насколько ушли
        // ЗА него»: цена уже с другой стороны. Возврат — эта же величина плюс
        // заход обратно, её и показываем в карточке.
        returnMoveAtr: setup2b?.returnMoveAtr ?? null,
        bias: signals.bias,
        direction: signals.direction,
        signals: { for: signals.for, against: signals.against },
        // БСУ — бар, на котором уровень образовался; по нему в карточке
        // ставится стрелка и подпись с датой.
        bsuAt: new Date(level.formedAt),
        quality,
        score: qualityScore(quality, level.strength, signals.bias, setup2b?.returnMoveAtr ?? null),
        atr,
        currentPrice,
        candlesFrom,
        candlesTo,
        // В долларах (объём в базовом активе × цена закрытия), а не в штуках
        // токена — так число хоть в общем порядке сопоставимо с $-объёмом,
        // который показывают биржевые виджеты (хотя те агрегируют несколько
        // бирж, а здесь только Binance USDT-M).
        lastVolume: lastVolumeUsd,
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
