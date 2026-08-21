/**
 * breakoutSignals.ts — разметка факторов "за пробой"/"за ложный пробой" для
 * уровня рядом с текущей ценой, по докам docs/trade/*.pdf. Скоуп сознательно
 * ограничен двумя сетапами (см. TRADE_RECOMMENDATIONS_PLAN.md, п.0):
 * "Пробой" и "Ложный пробой" — без "Отбоя", "ЛП2Б/СЛП", "Импульс-ретест",
 * "Контртренда".
 *
 * Прозрачно: не скрытый скоринг, а список конкретных сработавших условий
 * из документа — итоговый bias лишь простое большинство. Метод дискреционный
 * по своей природе (сам документ об этом явно предупреждает), окончательное
 * решение — за пользователем.
 */

import type { DailyCandle } from "./levels";

export type Bias = "breakout" | "false_breakout" | "neutral";

/**
 * Сторона сделки, которую подразумевает сетап. Базово выводится из положения
 * уровня относительно текущей цены — цена подходит к уровню и пробивает его
 * дальше в ту же сторону:
 *  - уровень ВЫШЕ цены: пробой = вверх (long), ложный пробой = отбой вниз (short);
 *  - уровень НИЖЕ цены: пробой = вниз (short), ложный пробой = отбой вверх (long).
 *
 * Исключение — уровень, который цена пробила ТОЛЬКО ЧТО (см. freshBreakDirection).
 * Тогда «подхода» не было: цена уже по другую сторону, и пробой продолжается
 * в том направлении, в котором случился, а не разворачивается навстречу. Без
 * этой поправки свежепробитая вниз поддержка читалась как «сопротивление над
 * ценой» и давала лонг в падающем рынке.
 *
 * Для нейтрального bias направления нет.
 */
export type Direction = "long" | "short";

/**
 * Насколько недавним должен быть переход цены через уровень, чтобы считать
 * его «тем самым» пробоем, а не сменой роли уровня. Старый переход означает
 * обратное: цена давно закрепилась с этой стороны, уровень стал зеркальным,
 * и подход к нему — снова обычный подход.
 */
export const FRESH_BREAK_BARS = 10;

/**
 * Направление последнего перехода цены через уровень, если он свежий.
 * `deadband` гасит дрожание закрытий вокруг самого уровня.
 */
export function freshBreakDirection(
  candles: DailyCandle[],
  levelPrice: number,
  deadband = 0,
  freshBars = FRESH_BREAK_BARS,
): "up" | "down" | null {
  const sideOf = (close: number): 1 | -1 | 0 => {
    if (close > levelPrice + deadband) return 1;
    if (close < levelPrice - deadband) return -1;
    return 0;
  };
  const currentSide = sideOf(candles[candles.length - 1].c);
  if (currentSide === 0) return null;
  // Идём назад до первого бара, закрывшегося по ДРУГУЮ сторону уровня.
  for (let i = candles.length - 2, bars = 1; i >= 0; i--, bars++) {
    const side = sideOf(candles[i].c);
    if (side === 0 || side === currentSide) continue;
    return bars <= freshBars ? (currentSide === 1 ? "up" : "down") : null;
  }
  return null; // цена всю историю с этой стороны — уровень не пробивали вовсе
}

export interface BreakoutSignals {
  for: string[];
  against: string[];
  bias: Bias;
  direction: Direction | null;
}

export function biasDirection(
  bias: Bias,
  levelPrice: number,
  currentPrice: number,
  freshBreak: "up" | "down" | null = null,
): Direction | null {
  if (bias === "neutral") return null;
  // Уровень только что пробит: сторона пробоя уже известна по факту, гадать
  // по геометрии не нужно. Пробой = продолжение в ту же сторону, ложный
  // пробой = возврат обратно за уровень.
  if (freshBreak) {
    const continuation: Direction = freshBreak === "up" ? "long" : "short";
    return bias === "breakout" ? continuation : continuation === "long" ? "short" : "long";
  }
  const levelAbove = levelPrice >= currentPrice;
  if (bias === "breakout") return levelAbove ? "long" : "short";
  return levelAbove ? "short" : "long";
}

export interface FalseBreakoutEvent {
  barIndex: number;
  t: number;
  levelPrice: number;
  direction: "up" | "down";
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Простой ложный пробой (постфактум): закрытие ушло за уровень относительно
// предыдущего закрытия, но на следующем баре вернулось обратно — без
// продолжения. Используется и для подсветки прошлых случаев на картинке, и
// как вход в сигнал "нет реакции на ЛП" ниже.
export function detectPastFalseBreakouts(candles: DailyCandle[], levelPrice: number): FalseBreakoutEvent[] {
  const events: FalseBreakoutEvent[] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    const next = candles[i + 1];
    if (prev.c < levelPrice && cur.c > levelPrice && next.c < levelPrice) {
      events.push({ barIndex: i, t: cur.t, levelPrice, direction: "up" });
    } else if (prev.c > levelPrice && cur.c < levelPrice && next.c > levelPrice) {
      events.push({ barIndex: i, t: cur.t, levelPrice, direction: "down" });
    }
  }
  return events;
}

// Предыдущие касания уровня (кроме самого последнего бара — "сегодня"),
// с допуском tolerance*ATR, чтобы не требовать точного пересечения.
function priorTouchIndexes(candles: DailyCandle[], levelPrice: number, atr: number, toleranceAtrFrac = 0.3): number[] {
  const tolerance = atr * toleranceAtrFrac;
  const touches: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.l - tolerance <= levelPrice && c.h + tolerance >= levelPrice) touches.push(i);
  }
  return touches;
}

export function computeBreakoutSignals(
  candles: DailyCandle[],
  levelPrice: number,
  atr: number,
  levelType?: string,
  /** Время БСУ: раньше него уровня не существовало (см. freshBreakDirection). */
  levelFormedAt?: number,
): BreakoutSignals {
  const forFactors: string[] = [];
  const againstFactors: string[] = [];
  if (candles.length < 6 || atr <= 0) return { for: [], against: [], bias: "neutral", direction: null };

  const last = candles[candles.length - 1];
  const history = candles.slice(0, -1); // без сегодняшнего бара — для поиска прошлых касаний/ЛП
  // Бары, в которых уровень уже существовал. Без БСУ — вся история, как раньше.
  const sinceLevel =
    levelFormedAt == null ? candles : candles.filter((c) => c.t >= levelFormedAt);
  // Пустым не бывает (БСУ всегда из этих же свечей), но одного бара хватает:
  // freshBreakDirection на нём просто вернёт null — пробоя ещё не было.
  const freshBreakBars = sinceLevel.length > 0 ? sinceLevel : candles.slice(-1);

  // Подход: размер последних баров относительно ATR ("на малых/больших барах").
  const approach3 = candles.slice(-3);
  const approachAvgRange = mean(approach3.map((c) => c.h - c.l));
  const approachRatio = approachAvgRange / atr;
  if (approachRatio <= 0.6) forFactors.push("small_bars_approach");
  if (approachRatio >= 1.2) againstFactors.push("big_bars_approach");

  // Накопление перед уровнем (узкий диапазон последних 5 баров) vs длинное
  // безоткатное движение БЕЗ накопления — см. комментарий в шапке файла:
  // "нет отката" сам по себе неоднозначен в доке, разрешаем через накопление.
  //
  // Второй признак — узкий разброс ЗАКРЫТИЙ последних трёх баров. После
  // импульсного бара цена часто стоит телами на одном месте, продолжая
  // пилить хвостами: по хай-лоу такая пауза выглядит размахом в несколько
  // ATR, хотя на графике это очевидное поджатие к уровню (ZHIPUUSDT 18-20.08:
  // закрытия 132.04 / 131.45 / 131.73 при размахе окна в 2×ATR).
  const window5 = candles.slice(-5);
  const windowRange = Math.max(...window5.map((c) => c.h)) - Math.min(...window5.map((c) => c.l));
  const closes3 = candles.slice(-3).map((c) => c.c);
  const closesRange = Math.max(...closes3) - Math.min(...closes3);
  const accumulating = windowRange <= atr * 1.0 || closesRange <= atr * 0.25;
  if (accumulating) {
    forFactors.push("accumulation_before_level");
  } else {
    const netMove = Math.abs(last.c - window5[0].o);
    if (netMove >= atr * 2) againstFactors.push("long_move_no_accumulation");
  }

  // Закрытие дневного бара относительно уровня.
  const closeDist = Math.abs(last.c - levelPrice);
  if (closeDist <= atr * 0.5) forFactors.push("close_near_level");
  else againstFactors.push("close_far_from_level");

  // Открытие сегодняшнего бара относительно уровня.
  const openDist = Math.abs(last.o - levelPrice);
  if (openDist > atr * 0.5) againstFactors.push("open_far_from_level");

  // Давность последнего ретеста (ближний <=10 дней, дальний >30 дней).
  const touches = priorTouchIndexes(history, levelPrice, atr);
  if (touches.length > 0) {
    const lastTouchIdx = touches[touches.length - 1];
    const daysSince = history.length - lastTouchIdx; // 1 бар = 1 день на D1
    if (daysSince <= 10) forFactors.push("near_retest");
    else if (daysSince > 30) againstFactors.push("far_retest");
  }

  // Нет реакции на предыдущий ложный пробой — после него не было глубокого
  // отката, значит вероятен пробой (энергия "засаженных" участников).
  const pastFalse = detectPastFalseBreakouts(history, levelPrice);
  if (pastFalse.length > 0) {
    const lastEvent = pastFalse[pastFalse.length - 1];
    const barsAfter = history.slice(lastEvent.barIndex + 1);
    if (barsAfter.length > 0) {
      const maxRetrace = Math.max(...barsAfter.map((c) => Math.abs(c.c - levelPrice)));
      if (maxRetrace <= atr * 0.5) forFactors.push("no_reaction_to_false_breakout");
    }
  }

  // Объём — только если источник его вообще отдаёт (историческим свечам он
  // может быть не проставлен, тогда все v будут 0/undefined).
  const hasVolume = candles.some((c) => (c.v ?? 0) > 0);
  if (hasVolume) {
    // "Піддержується імпульсний хід" — последние бары идут объёмом заметно
    // выше среднего фона, подтверждая, что за подходом стоит реальный интерес.
    const recentVol = mean(approach3.map((c) => c.v ?? 0));
    const priorVol = mean(candles.slice(-13, -3).map((c) => c.v ?? 0));
    if (priorVol > 0 && recentVol >= priorVol * 1.2) forFactors.push("volume_supports_impulse");

    // "Якщо у нас формується добрий ЛП ви завжди бачите всплеск об'ємів" —
    // сегодняшний бар проколол уровень хаем/лоу, но закрылся обратно
    // (классический прокол), и сделал это на объёме выше фона.
    const levelAbove = levelPrice >= last.c;
    const piercedToday = levelAbove ? last.h > levelPrice && last.c < levelPrice : last.l < levelPrice && last.c > levelPrice;
    if (piercedToday) {
      const priorVolForPierce = mean(history.slice(-10).map((c) => c.v ?? 0));
      if (priorVolForPierce > 0 && (last.v ?? 0) >= priorVolForPierce * 1.3) {
        againstFactors.push("volume_spike_on_pierce");
      }
    }
  }

  // Паранормальный бар подходит к уровню, но закрывается у самого своего
  // хая/лоу (без внутрибарного отката) — конспект называет это исключением
  // из "паранормальные бары = за ЛП": если отката внутри бара не было, это
  // говорит за продолжение, а не разворот.
  const lastRange = last.h - last.l;
  if (lastRange >= atr * 2) {
    const levelAbove = levelPrice >= last.c;
    const closeNearHigh = last.h - last.c <= lastRange * 0.1;
    const closeNearLow = last.c - last.l <= lastRange * 0.1;
    const movingUpToLevel = levelAbove && closeNearHigh;
    const movingDownToLevel = !levelAbove && closeNearLow;
    if (movingUpToLevel || movingDownToLevel) forFactors.push("paranormal_no_pullback");
  }

  const bias: Bias =
    forFactors.length > againstFactors.length
      ? "breakout"
      : againstFactors.length > forFactors.length
        ? "false_breakout"
        : "neutral";

  // "Локальна ситуація" (local_stop) уже прошла собственную проверку
  // подтверждения в детекторе — checkLocalStop (levels.ts) не отдаёт уровень
  // дальше, если после опорного бара не набралось нужных дней, которые не
  // ушли далеко за неё. Раз level.type === "local_stop" вообще попал сюда,
  // подтверждение уже случилось, и это стоит показать пользователю как факт.
  // Добавляется ПОСЛЕ подсчёта bias — сама по себе достоверность уровня не
  // довод именно ЗА пробой против ЛП (для ЛП уровень нужно так же
  // подтверждён), поэтому голосование bias эту метку не учитывает.
  const displayFor = levelType === "local_stop" && bias === "breakout" ? [...forFactors, "level_confirmed"] : forFactors;

  return {
    for: displayFor,
    against: againstFactors,
    bias,
    // Свежий пробой ищем только с БСУ и позже: до этого бара линии не
    // существовало, и переход цены через ту же ЦЕНУ пробоем этого уровня не
    // был. Иначе местная опора, образованная на откате после импульса,
    // читалась как «уровень только что пробит в сторону импульса», и ЛП от
    // неё разворачивался наизнанку (WENUSDT: опора 8.36 от 18.08 против
    // рывка 12.08 — ЛП давал шорт там, где геометрия просит лонг).
    direction: biasDirection(bias, levelPrice, last.c, freshBreakDirection(freshBreakBars, levelPrice, atr * 0.1)),
  };
}
