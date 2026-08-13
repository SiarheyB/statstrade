/**
 * quality.ts — отбор «готовых» уровней: не всё, что рядом с ценой, годится
 * для торговли. Метрики и пороги взяты из docs/trade/алгоритм.pdf и
 * docs/trade/твх.pdf, слайд «Пробой» (обязательные условия и раздел
 * «минусы — чего не должно быть»):
 *
 *   ОБЯЗАТЕЛЬНО: низкая волатильность, «пустота» в пробойной плоскости,
 *   УРОВЕНЬ БЕЗ ЗАПИЛОВ, плавный подход, запас хода.
 *   МИНУСЫ: запил, глубокий ЛП (стопы уже сняты), слом поджатия,
 *   подход на больших барах, далёкое закрытие D1 (0.5+ ATR до уровня).
 *
 * Плюс «предпосылки к отбою» (алгоритм.pdf, стр. 26): проторгованная зона за
 * уровнем — «зона заражённости»; если впереди проторгованная область,
 * инструменту тяжело пробить уровень с первого раза.
 *
 * Здесь считаются ИЗМЕРИМЫЕ по OHLC величины; решение «пропустить/отсеять»
 * принимает passesQualityGate ниже, а не спрятанный скоринг.
 */

import type { DailyCandle } from "./levels";

export type LevelSide = "above" | "below"; // уровень выше или ниже текущей цены

export interface LevelQuality {
  side: LevelSide;
  /** Запил: сколько раз закрытия перекладывались через уровень в окне анализа. */
  crossings: number;
  /** Сколько раз уровень прокалывался с возвратом (ложные пробои) в прошлом. */
  falseBreakouts: number;
  /** Глубина самого глубокого прокола, в ATR. 0 — проколов не было. */
  deepestFalseBreakoutAtr: number;
  /** Доля баров окна, заходивших в зону сразу ЗА уровнем («заражённость»). */
  contamination: number;
  /** Запас хода: до следующего уровня за пробойной плоскостью, в ATR. */
  runwayAtr: number;
  /** Насколько вчерашний день закрылся близко к уровню, в ATR. */
  closeDistanceAtr: number;
  /** Дотянулся ли вчерашний бар до уровня (хай/лоу в пределах допуска). */
  touched: boolean;
  /** Размер последних баров подхода относительно ATR. */
  approachRatio: number;
  /** Был ли гэп в сторону уровня среди последних баров. */
  gapApproach: boolean;
}

export interface QualityThresholds {
  /** Окно «левой стороны» (баров), в котором ищем запилы и проколы уровня. */
  window: number;
  /** Окно (баров) для проверки зоны за уровнем на проторговку. */
  contaminationWindow: number;
  /** Прокол мельче этого (в ATR) — рыночный шум, за ложный пробой не считаем. */
  minPierceAtr: number;
  /** Мёртвая зона вокруг уровня (в ATR): закрытия внутри неё не считаем переходом. */
  deadbandAtr: number;
  /** Ширина зоны за уровнем, которую проверяем на проторговку, в ATR. */
  contaminationZoneAtr: number;
  /** Допуск «бар дотянулся до уровня», в ATR. */
  touchToleranceAtr: number;
  maxCrossings: number;
  maxFalseBreakouts: number;
  /** Прокол глубже этого (в ATR) — «глубокий ЛП», стопы уже сняты. */
  deepFalseBreakoutAtr: number;
  maxContamination: number;
  minRunwayAtr: number;
  maxCloseDistanceAtr: number;
  /** Подход «на малых барах» — средний диапазон не больше этого × ATR. */
  smallBarsRatio: number;
  /** Подход «на больших барах» — средний диапазон не меньше этого × ATR. */
  bigBarsRatio: number;
}

// Пороги откалиброваны на реальной выдаче Binance USDT-M (526 пар): из ~2000
// уровней рядом с ценой гейт оставляет полтора-два десятка — то есть короткий
// список готовых инструментов, а не каталог рынка.
export const DEFAULT_THRESHOLDS: QualityThresholds = {
  // Запил смотрим по недавней истории (~3 месяца): «чистота слева» — про то,
  // как уровень вёл себя на подходе, а не про всю историю инструмента.
  window: 60,
  contaminationWindow: 120,
  minPierceAtr: 0.25,
  deadbandAtr: 0.1,
  contaminationZoneAtr: 1,
  touchToleranceAtr: 0.25,
  // «Уровень без запилов»: одна перекладка через уровень ещё допустима,
  // две и больше — уже распил.
  maxCrossings: 1,
  maxFalseBreakouts: 1,
  // «Глубокий ЛП» — стопы за уровнем уже сняты, энергии на пробой меньше.
  deepFalseBreakoutAtr: 0.75,
  // «Пустота в пробойной плоскости»: за уровнем почти не торговали.
  maxContamination: 0.1,
  minRunwayAtr: 1,
  // Док: далёкое закрытие — 0.5+ ATR до уровня. Нам нужен день, который
  // закрылся ВПЛОТНУЮ, поэтому берём вдвое строже.
  maxCloseDistanceAtr: 0.25,
  smallBarsRatio: 0.8,
  bigBarsRatio: 1.2,
};

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Сторона закрытия относительно уровня с мёртвой зоной: закрытия «на уровне»
// не считаем ни одной из сторон, иначе дрожание цены вокруг уровня выглядело
// бы как десятки перекладок.
function sideOfClose(close: number, levelPrice: number, deadband: number): 1 | -1 | 0 {
  if (close > levelPrice + deadband) return 1;
  if (close < levelPrice - deadband) return -1;
  return 0;
}

/**
 * Запил: сколько раз закрытия перекладывались через уровень. Чистый уровень —
 * это уровень, который цена уважала: подходила и уходила, а не пилила его
 * туда-сюда.
 */
export function countCrossings(candles: DailyCandle[], levelPrice: number, atr: number, deadbandAtr: number): number {
  const deadband = atr * deadbandAtr;
  let crossings = 0;
  let prevSide: 1 | -1 | 0 = 0;
  for (const c of candles) {
    const side = sideOfClose(c.c, levelPrice, deadband);
    if (side === 0) continue;
    if (prevSide !== 0 && side !== prevSide) crossings += 1;
    prevSide = side;
  }
  return crossings;
}

/**
 * Проколы уровня с возвратом: бар вышел за уровень хаем/лоу, но закрылся
 * обратно (док: «цена не может закрыться выше хая или ниже лоу предыдущего
 * дня»). Глубина прокола — на сколько ATR ушёл экстремум за уровень; глубокий
 * прокол значит, что стопы за уровнем уже сняты и энергии для пробоя меньше.
 */
export function findPierces(
  candles: DailyCandle[],
  levelPrice: number,
  atr: number,
  minPierceAtr: number,
): { count: number; deepestAtr: number } {
  const minPierce = atr * minPierceAtr;
  let count = 0;
  let deepestAtr = 0;
  // Сторону подхода берём по ПРЕДЫДУЩЕМУ закрытию: иначе бар, который пришёл
  // снизу и закрылся выше уровня (то есть пробил его), выглядел бы как прокол
  // сверху — его лоу ведь остался под уровнем.
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const from = candles[i - 1].c;
    const pierceUp = from < levelPrice && c.h > levelPrice + minPierce && c.c < levelPrice;
    const pierceDown = from > levelPrice && c.l < levelPrice - minPierce && c.c > levelPrice;
    if (!pierceUp && !pierceDown) continue;
    count += 1;
    const depth = (pierceUp ? c.h - levelPrice : levelPrice - c.l) / atr;
    if (depth > deepestAtr) deepestAtr = depth;
  }
  return { count, deepestAtr };
}

/**
 * Заражённость: доля баров окна, которые торговались в зоне сразу ЗА уровнем.
 * 0 — за уровнем «пустота» (док: чистая зона после прохождения уровня),
 * высокое значение — там уже была борьба, пробить с первого раза тяжело.
 */
export function contaminationRatio(
  candles: DailyCandle[],
  levelPrice: number,
  atr: number,
  side: LevelSide,
  zoneAtr: number,
  offsetAtr = 0.1,
): number {
  if (candles.length === 0) return 0;
  const zone = atr * zoneAtr;
  // Зона начинается СТРОГО за уровнем: бары, которые лишь упираются хаем в
  // сам уровень, — это подход к нему, а не проторговка за ним.
  const offset = atr * offsetAtr;
  const [lo, hi] =
    side === "above" ? [levelPrice + offset, levelPrice + zone] : [levelPrice - zone, levelPrice - offset];
  const inside = candles.filter((c) => c.h >= lo && c.l <= hi).length;
  return inside / candles.length;
}

/**
 * Запас хода: до ближайшего ЗНАЧИМОГО уровня за пробойной плоскостью, в ATR.
 * Если дальше уровней нет — Infinity («пустота», ходу ничего не мешает).
 * Считать по всем найденным уровням бессмысленно: детектор находит их
 * десятками на инструмент, и «следующий» всегда оказывается вплотную.
 */
export function runwayAtr(levelPrice: number, significantLevels: number[], atr: number, side: LevelSide): number {
  if (atr <= 0) return 0;
  const beyond = significantLevels.filter((p) => (side === "above" ? p > levelPrice : p < levelPrice));
  if (beyond.length === 0) return Infinity;
  const nearest = beyond.reduce((best, p) => (Math.abs(p - levelPrice) < Math.abs(best - levelPrice) ? p : best));
  return Math.abs(nearest - levelPrice) / atr;
}

// Гэп в сторону уровня среди последних баров: открытие оторвалось от
// предыдущего закрытия и сдвинуло цену к уровню (для ЛП — быстрый подход).
function hasGapApproach(candles: DailyCandle[], levelPrice: number, atr: number, minGapAtr = 0.3): boolean {
  const tail = candles.slice(-3);
  for (let i = 1; i < tail.length; i++) {
    const gap = tail[i].o - tail[i - 1].c;
    if (Math.abs(gap) < atr * minGapAtr) continue;
    const movedTowards = Math.abs(tail[i].o - levelPrice) < Math.abs(tail[i - 1].c - levelPrice);
    if (movedTowards) return true;
  }
  return false;
}

export function assessLevelQuality(
  candles: DailyCandle[],
  levelPrice: number,
  atr: number,
  currentPrice: number,
  significantLevels: number[],
  th: QualityThresholds = DEFAULT_THRESHOLDS,
): LevelQuality {
  const side: LevelSide = levelPrice >= currentPrice ? "above" : "below";
  const last = candles[candles.length - 1];
  // История без сегодняшнего бара — иначе текущий подход сам себя засчитает
  // как запил/прокол.
  const history = candles.slice(-th.window, -1);
  const contaminationHistory = candles.slice(-th.contaminationWindow, -1);

  const pierces = findPierces(history, levelPrice, atr, th.minPierceAtr);
  const approach3 = candles.slice(-3);
  const touchDistance = side === "above" ? levelPrice - last.h : last.l - levelPrice;

  return {
    side,
    crossings: countCrossings(history, levelPrice, atr, th.deadbandAtr),
    falseBreakouts: pierces.count,
    deepestFalseBreakoutAtr: pierces.deepestAtr,
    contamination: contaminationRatio(contaminationHistory, levelPrice, atr, side, th.contaminationZoneAtr),
    runwayAtr: runwayAtr(levelPrice, significantLevels, atr, side),
    closeDistanceAtr: Math.abs(last.c - levelPrice) / atr,
    touched: touchDistance <= atr * th.touchToleranceAtr,
    approachRatio: mean(approach3.map((c) => c.h - c.l)) / atr,
    gapApproach: hasGapApproach(candles, levelPrice, atr),
  };
}

/** JSON-безопасная форма метрик для колонки LevelSetup.quality. */
export type StoredQuality = Omit<LevelQuality, "runwayAtr"> & { runwayAtr: number | null };

/**
 * Infinity в JSON не существует (JSON.stringify превращает его в null молча),
 * поэтому «за уровнем препятствий нет» кодируем явным null.
 */
export function serializeQuality(q: LevelQuality): StoredQuality {
  return { ...q, runwayAtr: Number.isFinite(q.runwayAtr) ? q.runwayAtr : null };
}

export type RejectReason =
  | "close_far_from_level"
  | "did_not_reach_level"
  | "level_chopped"
  | "too_many_false_breakouts"
  | "deep_false_breakout"
  | "contaminated_zone"
  | "no_runway"
  | "no_breakout_preconditions"
  | "no_false_breakout_preconditions";

export interface GateResult {
  ok: boolean;
  rejectedBy: RejectReason[];
}

/**
 * Пропускает только «готовые сегодня» уровни. Проверки общие для обоих
 * сетапов (чистота уровня + вчерашний день вплотную), плюс требования,
 * специфичные для сетапа:
 *
 *  - пробой: обязательна низкая волатильность подхода — малые бары и/или
 *    накопление/поджатие перед уровнем (твх.pdf, обязательные условия);
 *  - ложный пробой: наоборот, нужен быстрый подход — большие бары, гэп или
 *    длинное безоткатное движение (алгоритм.pdf, «предпосылки к отбою»).
 */
export function passesQualityGate(
  q: LevelQuality,
  bias: "breakout" | "false_breakout",
  signals: { for: string[]; against: string[] },
  th: QualityThresholds = DEFAULT_THRESHOLDS,
): GateResult {
  const rejectedBy: RejectReason[] = [];

  if (q.closeDistanceAtr > th.maxCloseDistanceAtr) rejectedBy.push("close_far_from_level");
  if (!q.touched) rejectedBy.push("did_not_reach_level");
  if (q.crossings > th.maxCrossings) rejectedBy.push("level_chopped");
  if (q.falseBreakouts > th.maxFalseBreakouts) rejectedBy.push("too_many_false_breakouts");
  if (q.deepestFalseBreakoutAtr > th.deepFalseBreakoutAtr) rejectedBy.push("deep_false_breakout");
  if (q.contamination > th.maxContamination) rejectedBy.push("contaminated_zone");
  if (q.runwayAtr < th.minRunwayAtr) rejectedBy.push("no_runway");

  if (bias === "breakout") {
    const calmApproach =
      q.approachRatio <= th.smallBarsRatio ||
      signals.for.includes("accumulation_before_level") ||
      signals.for.includes("small_bars_approach");
    if (!calmApproach || q.gapApproach) rejectedBy.push("no_breakout_preconditions");
  } else {
    const fastApproach =
      q.approachRatio >= th.bigBarsRatio ||
      q.gapApproach ||
      signals.against.includes("big_bars_approach") ||
      signals.against.includes("long_move_no_accumulation");
    if (!fastApproach) rejectedBy.push("no_false_breakout_preconditions");
  }

  return { ok: rejectedBy.length === 0, rejectedBy };
}

/**
 * Ранжирование прошедших отбор: чем ближе вчерашнее закрытие к уровню, чище
 * история и больше запас хода — тем выше. Нужно, чтобы из прошедших гейт
 * оставить в выдаче только несколько лучших инструментов.
 */
export function qualityScore(q: LevelQuality, strength: number): number {
  const closeness = 1 - Math.min(1, q.closeDistanceAtr / DEFAULT_THRESHOLDS.maxCloseDistanceAtr);
  const clean = 1 - Math.min(1, q.crossings / (DEFAULT_THRESHOLDS.maxCrossings + 1));
  const empty = 1 - Math.min(1, q.contamination / DEFAULT_THRESHOLDS.maxContamination);
  const runway = Math.min(1, (Number.isFinite(q.runwayAtr) ? q.runwayAtr : 5) / 5);
  const strengthNorm = Math.min(1, strength / 6);
  return 0.35 * closeness + 0.2 * clean + 0.2 * empty + 0.15 * runway + 0.1 * strengthNorm;
}
