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

export interface BreakoutSignals {
  for: string[];
  against: string[];
  bias: Bias;
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

export function computeBreakoutSignals(candles: DailyCandle[], levelPrice: number, atr: number): BreakoutSignals {
  const forFactors: string[] = [];
  const againstFactors: string[] = [];
  if (candles.length < 6 || atr <= 0) return { for: [], against: [], bias: "neutral" };

  const last = candles[candles.length - 1];
  const history = candles.slice(0, -1); // без сегодняшнего бара — для поиска прошлых касаний/ЛП

  // Подход: размер последних баров относительно ATR ("на малых/больших барах").
  const approach3 = candles.slice(-3);
  const approachAvgRange = mean(approach3.map((c) => c.h - c.l));
  const approachRatio = approachAvgRange / atr;
  if (approachRatio <= 0.6) forFactors.push("small_bars_approach");
  if (approachRatio >= 1.2) againstFactors.push("big_bars_approach");

  // Накопление перед уровнем (узкий диапазон последних 5 баров) vs длинное
  // безоткатное движение БЕЗ накопления — см. комментарий в шапке файла:
  // "нет отката" сам по себе неоднозначен в доке, разрешаем через накопление.
  const window5 = candles.slice(-5);
  const windowRange = Math.max(...window5.map((c) => c.h)) - Math.min(...window5.map((c) => c.l));
  const accumulating = windowRange <= atr * 1.0;
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

  const bias: Bias =
    forFactors.length > againstFactors.length
      ? "breakout"
      : againstFactors.length > forFactors.length
        ? "false_breakout"
        : "neutral";

  return { for: forFactors, against: againstFactors, bias };
}
