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
  /** Самая длинная серия проколов ПОДРЯД (см. maxConsecutivePierces). */
  consecutiveFalseBreakouts: number;
  /** Доля баров окна, заходивших в зону сразу ЗА уровнем («заражённость»). */
  contamination: number;
  /** Запас хода: до следующего уровня за пробойной плоскостью, в ATR. */
  runwayAtr: number;
  /** Насколько вчерашний день закрылся близко к уровню, в ATR. */
  closeDistanceAtr: number;
  /** Дотянулся ли вчерашний бар до уровня (хай/лоу в пределах допуска). */
  touched: boolean;
  /**
   * Насколько хай/лоу вчерашнего бара НЕ дотянулся до уровня, в ATR (та же
   * величина, что стоит за touched, но со знаком и не булева: отрицательная,
   * если бар уже пробил уровень). Для ЛП это ключевая метрика подхода:
   * конспект требует, чтобы вчера бар остановился ДАЛЕКО (обычно ~1×ATR) от
   * уровня — тогда сегодняшний бар должен пройти весь этот путь, проколоть
   * уровень и вернуться, а не просто чуть подрасти рядом с ним.
   */
  approachGapAtr: number;
  /** Размер последних баров подхода относительно ATR. */
  approachRatio: number;
  /** Был ли гэп в сторону уровня среди последних баров. */
  gapApproach: boolean;
  /**
   * Чистое смещение цены за последние fastApproachWindow баров, в ATR —
   * "довгий безвідкатний рух" из конспекта. В отличие от approachRatio
   * (средний размер только 3 последних баров, легко ложно срабатывает на
   * шумном хвосте долгого пологого "закруглення" к уровню — плюс для
   * ПРОБОЯ, а не предпосылка ЛП), это смотрит на весь путь: медленный
   * многодневный подход даёт маленькое netMove, даже если пара последних
   * баров случайно крупнее обычного.
   */
  approachNetMoveAtr: number;
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
  /** Сколько проколов ПОДРЯД ещё допустимо (2 подряд — уровень распилен). */
  maxConsecutiveFalseBreakouts: number;
  /**
   * Порог глубины для проколов В СЕРИИ — заметно мягче minPierceAtr. Одиночный
   * прокол в истории имеет смысл считать только если он глубже шума, но для
   * распила важен сам факт: уровень пройден и брошен два дня подряд. Реальный
   * пример (GEV, ATR 36.5): хай 14.08 ушёл за уровень на 0.094×ATR, хай 15.08 —
   * на 0.066×ATR; при общем пороге 0.08 второй бар считался «шумом», и распил
   * проходил гейт. Конспект относит к «неглубокому ЛП» проколы до 0.10-0.15×ATR
   * — то есть оба этих бара полноценные ЛП, а не шум.
   */
  consecutivePierceAtr: number;
  /** Прокол глубже этого (в ATR) — «глубокий ЛП», стопы уже сняты. */
  deepFalseBreakoutAtr: number;
  maxContamination: number;
  minRunwayAtr: number;
  maxCloseDistanceAtr: number;
  /**
   * Для ЛП: вчерашний хай/лоу должен НЕ дотягивать до уровня минимум на
   * столько ATR — сегодняшний бар обязан пройти этот путь целиком, проколоть
   * уровень и вернуться, а не просто закрыться рядом. Противоположность
   * maxCloseDistanceAtr (который про пробой: там нужно закрытие ВПЛОТНУЮ).
   */
  minFalseBreakoutApproachGapAtr: number;
  /** Подход «на малых барах» — средний диапазон не больше этого × ATR. */
  smallBarsRatio: number;
  /** Подход «на больших барах» — средний диапазон не меньше этого × ATR. */
  bigBarsRatio: number;
  /** Сколько баров смотрим для approachNetMoveAtr (см. LevelQuality). */
  fastApproachWindow: number;
  /** ЛП: минимальное чистое смещение за fastApproachWindow баров, в ATR —
   *  порог "довгого безвідкатного руху", отделяющий настоящий быстрый заход
   *  от многодневного пологого закругления к уровню. */
  minFastApproachNetMoveAtr: number;
}

// Пороги откалиброваны на реальной выдаче Binance USDT-M (526 пар): из ~2000
// уровней рядом с ценой гейт оставляет полтора-два десятка — то есть короткий
// список готовых инструментов, а не каталог рынка.
export const DEFAULT_THRESHOLDS: QualityThresholds = {
  // Запил смотрим по недавней истории (~3 месяца): «чистота слева» — про то,
  // как уровень вёл себя на подходе, а не про всю историю инструмента.
  window: 60,
  contaminationWindow: 120,
  // Конспект: "неглибокий ЛП це розмір стопа (до 10-15% АТР)" — порог шума
  // должен быть НИЖЕ верхней границы "неглубокого" ЛП, иначе как раз
  // неглубокие проколы (самые частые и самые говорящие) тонут в шуме и
  // никогда не попадают в falseBreakouts. Раньше здесь стояло 0.25 — выше
  // всего диапазона "неглубокого" ЛП по документу.
  minPierceAtr: 0.08,
  deadbandAtr: 0.1,
  contaminationZoneAtr: 1,
  touchToleranceAtr: 0.25,
  // «Уровень без запилов»: одна перекладка через уровень ещё допустима,
  // две и больше — уже распил.
  maxCrossings: 1,
  maxFalseBreakouts: 1,
  // Один прокол — снятые стопы, это даже плюс. Два ПОДРЯД (вчера проколол и
  // сегодня снова) — уровень уже не держит, торговать его нельзя.
  maxConsecutiveFalseBreakouts: 1,
  // Почти любой выход за уровень с возвратом: важен факт, а не глубина.
  // Ниже — уже дрожание цены на тик от уровня.
  consecutivePierceAtr: 0.02,
  // «Глубокий ЛП» — стопы за уровнем уже сняты, энергии на пробой меньше.
  deepFalseBreakoutAtr: 0.75,
  // «Пустота в пробойной плоскости»: за уровнем почти не торговали.
  maxContamination: 0.1,
  minRunwayAtr: 1,
  // Док: далёкое закрытие — 0.5+ ATR до уровня. Нам нужен день, который
  // закрылся ВПЛОТНУЮ, поэтому берём вдвое строже.
  maxCloseDistanceAtr: 0.25,
  // Для ЛП — обратное требование: вчера бар должен был остановиться далеко
  // ОТ уровня, целый ATR, чтобы сегодняшний бар делал весь путь + прокол +
  // возврат за один день (а не просто чуть доставал до уровня).
  minFalseBreakoutApproachGapAtr: 1,
  smallBarsRatio: 0.8,
  bigBarsRatio: 1.2,
  // Разделяет реальный "довгий безвідкатний рух" от многодневного пологого
  // закругления к уровню (плюс для ПРОБОЯ, не для ЛП). На реальной выдаче
  // (10 инструментов, размеченных вручную) чистое разделение: у ложных
  // срабатываний ("закругление") netMove за 10 баров не превышал ~1.1×ATR,
  // у настоящих быстрых подходов — не ниже ~2.3×ATR. Порог 1.5 — с запасом
  // посередине.
  fastApproachWindow: 10,
  minFastApproachNetMoveAtr: 1.5,
};

// Для local_stop (см. levels.ts): уровню всего 1-10 дней, а не месяцы. Гейт
// на DEFAULT_THRESHOLDS.window/contaminationWindow (60/120 дней) смотрел бы на
// историю, которая ЗАВЕДОМО старше самого уровня — включая, например, обвал,
// после которого уровень и образовался, засчитывая его как "запил"/"грязную
// зону", хотя тот вообще не имеет отношения к этой конкретной опорной точке.
// Остальные пороги те же — сама методика оценки чистоты не меняется, меняется
// только окно, в котором её применять.
export const LOCAL_THRESHOLDS: QualityThresholds = {
  ...DEFAULT_THRESHOLDS,
  window: 10,
  contaminationWindow: 15,
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
 * Самая длинная серия ПОДРЯД идущих проколов уровня. Два соседних бара, каждый
 * из которых вышел за уровень и вернулся, — это уже не «один аккуратный ЛП, на
 * котором сняли стопы», а распил: уровень перестал держать, цена ходит сквозь
 * него туда-сюда каждый день. Один такой бар допустим (и даже полезен —
 * стопы сняты), два подряд — сетап уже не торгуем.
 *
 * В отличие от falseBreakouts, считается по окну ВМЕСТЕ с последним закрытым
 * баром: именно свежая пара «вчера проколол — сегодня снова проколол» и есть
 * признак распила, а он весь лежит в самом конце окна.
 */
export function maxConsecutivePierces(
  candles: DailyCandle[],
  levelPrice: number,
  atr: number,
  minPierceAtr: number,
): number {
  const minPierce = atr * minPierceAtr;
  let best = 0;
  let streak = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const from = candles[i - 1].c;
    const pierceUp = from < levelPrice && c.h > levelPrice + minPierce && c.c < levelPrice;
    const pierceDown = from > levelPrice && c.l < levelPrice - minPierce && c.c > levelPrice;
    if (pierceUp || pierceDown) {
      streak += 1;
      if (streak > best) best = streak;
    } else {
      streak = 0;
    }
  }
  return best;
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

// Чистое смещение цены за последние `window` баров, в ATR — см. LevelQuality.
// approachNetMoveAtr. Не привязано к направлению уровня: это просто модуль
// пройденного пути, конспект говорит "довгий безвідкатний рух" безотносительно
// к тому, куда именно он идёт.
function netMoveAtr(candles: DailyCandle[], atr: number, window: number): number {
  if (atr <= 0 || candles.length === 0) return 0;
  const win = candles.slice(-window);
  return Math.abs(win[win.length - 1].c - win[0].o) / atr;
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
  // Серию проколов считаем по окну ВМЕСТЕ с последним закрытым баром: пара
  // «вчера проколол — сегодня снова проколол» целиком лежит в конце окна и в
  // history (без последнего бара) была бы не видна.
  const windowWithLast = candles.slice(-th.window);
  const approach3 = candles.slice(-3);
  const touchDistance = side === "above" ? levelPrice - last.h : last.l - levelPrice;

  return {
    side,
    crossings: countCrossings(history, levelPrice, atr, th.deadbandAtr),
    falseBreakouts: pierces.count,
    deepestFalseBreakoutAtr: pierces.deepestAtr,
    consecutiveFalseBreakouts: maxConsecutivePierces(windowWithLast, levelPrice, atr, th.consecutivePierceAtr),
    contamination: contaminationRatio(contaminationHistory, levelPrice, atr, side, th.contaminationZoneAtr),
    runwayAtr: runwayAtr(levelPrice, significantLevels, atr, side),
    closeDistanceAtr: Math.abs(last.c - levelPrice) / atr,
    touched: touchDistance <= atr * th.touchToleranceAtr,
    approachGapAtr: touchDistance / atr,
    approachRatio: mean(approach3.map((c) => c.h - c.l)) / atr,
    gapApproach: hasGapApproach(candles, levelPrice, atr),
    approachNetMoveAtr: netMoveAtr(candles, atr, th.fastApproachWindow),
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
  | "close_near_level"
  | "level_chopped"
  | "too_many_false_breakouts"
  | "consecutive_false_breakouts"
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
 * сетапов (чистота уровня, запас хода), плюс требования, специфичные для
 * сетапа:
 *
 *  - пробой: закрытие ВПЛОТНУЮ к уровню (maxCloseDistanceAtr) + обязательна
 *    низкая волатильность подхода — малые бары и/или накопление/поджатие
 *    перед уровнем (твх.pdf, обязательные условия);
 *  - ложный пробой: наоборот, вчерашний бар должен был остановиться ДАЛЕКО
 *    от уровня (minFalseBreakoutApproachGapAtr) — весь путь до уровня,
 *    прокол и возврат должен сделать сегодняшний бар — плюс быстрый подход:
 *    большие бары, гэп или длинное безоткатное движение (алгоритм.pdf,
 *    «предпосылки к отбою»). Близкое вчерашнее закрытие для ЛП — не плюс, а
 *    минус: разгона для прокола и возврата за один день уже не остаётся.
 */
export function passesQualityGate(
  q: LevelQuality,
  bias: "breakout" | "false_breakout",
  signals: { for: string[]; against: string[] },
  th: QualityThresholds = DEFAULT_THRESHOLDS,
): GateResult {
  const rejectedBy: RejectReason[] = [];

  if (q.crossings > th.maxCrossings) rejectedBy.push("level_chopped");
  if (q.falseBreakouts > th.maxFalseBreakouts) rejectedBy.push("too_many_false_breakouts");
  // Два прокола подряд — уровень распилен: он больше не держит цену, и ни
  // пробой, ни ЛП от него отрабатывать нечего.
  if (q.consecutiveFalseBreakouts > th.maxConsecutiveFalseBreakouts) rejectedBy.push("consecutive_false_breakouts");
  if (q.deepestFalseBreakoutAtr > th.deepFalseBreakoutAtr) rejectedBy.push("deep_false_breakout");
  if (q.contamination > th.maxContamination) rejectedBy.push("contaminated_zone");
  if (q.runwayAtr < th.minRunwayAtr) rejectedBy.push("no_runway");

  if (bias === "breakout") {
    if (q.closeDistanceAtr > th.maxCloseDistanceAtr) rejectedBy.push("close_far_from_level");
    if (!q.touched) rejectedBy.push("did_not_reach_level");
    const calmApproach =
      q.approachRatio <= th.smallBarsRatio ||
      signals.for.includes("accumulation_before_level") ||
      signals.for.includes("small_bars_approach");
    if (!calmApproach || q.gapApproach) rejectedBy.push("no_breakout_preconditions");
  } else {
    if (q.approachGapAtr < th.minFalseBreakoutApproachGapAtr) rejectedBy.push("close_near_level");
    // НЕ approachRatio/big_bars_approach (последние 3 бара) — многодневное
    // пологое "закруглення" к уровню легко даёт пару случайно более крупных
    // баров в конце и ложно проходит эту проверку, хотя реального "довгого
    // безвідкатного руху" там не было (см. approachNetMoveAtr — чистое
    // смещение за весь подход, а не шум последних баров).
    const fastApproach = q.approachNetMoveAtr >= th.minFastApproachNetMoveAtr || q.gapApproach;
    if (!fastApproach) rejectedBy.push("no_false_breakout_preconditions");
  }

  return { ok: rejectedBy.length === 0, rejectedBy };
}

/**
 * Ранжирование прошедших отбор: чище история и больше запас хода — тем выше;
 * а вот "подход" считается по-разному для двух сетапов (см. passesQualityGate)
 * — для пробоя чем ближе вчерашнее закрытие к уровню, тем лучше, для ЛП
 * наоборот: чем дальше вчера остановились от уровня, тем чище будет разгон
 * сегодняшнего прокола и возврата. Нужно, чтобы из прошедших гейт оставить в
 * выдаче только несколько лучших инструментов.
 */
export function qualityScore(q: LevelQuality, strength: number, bias: "breakout" | "false_breakout" = "breakout"): number {
  const closeness =
    bias === "breakout"
      ? 1 - Math.min(1, q.closeDistanceAtr / DEFAULT_THRESHOLDS.maxCloseDistanceAtr)
      : Math.min(1, q.approachGapAtr / (DEFAULT_THRESHOLDS.minFalseBreakoutApproachGapAtr * 2));
  const clean = 1 - Math.min(1, q.crossings / (DEFAULT_THRESHOLDS.maxCrossings + 1));
  const empty = 1 - Math.min(1, q.contamination / DEFAULT_THRESHOLDS.maxContamination);
  const runway = Math.min(1, (Number.isFinite(q.runwayAtr) ? q.runwayAtr : 5) / 5);
  const strengthNorm = Math.min(1, strength / 6);
  return 0.35 * closeness + 0.2 * clean + 0.2 * empty + 0.15 * runway + 0.1 * strengthNorm;
}
