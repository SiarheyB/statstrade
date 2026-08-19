/**
 * falseBreakout2b.ts — ЛП2Б, ложный пробой второго бара.
 *
 * Обычный ЛП требует, чтобы ОДИН бар прошёл весь путь до уровня, проколол его
 * и вернулся. У ЛП2Б работа разложена на два дня:
 *
 *   бар 1 (уже случился) — быстрый подход, пробой уровня, ЗАКРЫТИЕ за уровнем;
 *   бар 2 (завтра)       — удержаться за уровнем не выходит, цена возвращается
 *                          обратно, и вход берётся на этом возврате.
 *
 * Отсюда главное отличие от обычного ЛП, ради которого сетап и добавлен: цена
 * уже стоит вплотную к уровню, и завтрашнему бару нужен не полный ATR, а
 * только возврат под уровень — а это доли ATR (см. returnMoveAtr).
 *
 * Ключевое условие — «закрылись за уровнем, но НЕДАЛЕКО» (maxCloseBeyondAtr):
 * пробой с сильным закрытием далеко за уровнем это не заготовка под разворот,
 * а обычный состоявшийся пробой, и ждать от него возврата нечего.
 */

import type { DailyCandle } from "./levels";

export interface FalseBreakout2bThresholds {
  /** Максимальное закрытие ЗА уровнем, в ATR: дальше это уже честный пробой. */
  maxCloseBeyondAtr: number;
  /** Минимальный выход хая/лоу за уровень — иначе уровень не пробит, а лишь задет. */
  minPierceAtr: number;
  /**
   * Минимальное закрытие ЗА уровнем. Закрытие в паре сотых ATR от уровня — это
   * «закрылись НА уровне», а не «пробили и закрепились за ним»: возвращать
   * завтра нечего, цена и так стоит на линии.
   */
  minCloseBeyondAtr: number;
  /** Быстрый подход: чистое смещение за окно, в ATR. */
  minApproachNetMoveAtr: number;
  /** Либо подход «на больших барах»: средний размах последних баров к ATR. */
  minApproachBarsRatio: number;
  /** Окно для чистого смещения подхода, баров. */
  approachWindow: number;
  /** Дальний ретест: уровень не трогали хотя бы столько дней до пробоя. */
  minDaysSinceTouch: number;
  /**
   * Накопление под уровнем: диапазон баров перед пробоем не шире этого × ATR.
   * Для 2Б это ЗАПРЕТ — поджатие к уровню готовит честный пробой, а не
   * возврат: подходить к уровню нужно с разгона, а не подползать вплотную.
   */
  accumulationRangeAtr: number;
  /** Сколько баров перед пробойным смотрим на накопление. */
  accumulationWindow: number;
  /** Допуск «бар коснулся уровня» при поиске прошлых касаний, в ATR. */
  touchToleranceAtr: number;
}

export const DEFAULT_2B_THRESHOLDS: FalseBreakout2bThresholds = {
  // «Закрылись впритык за уровнем» — ради этого сетап и нужен. Порог выбран
  // по живой выдаче (696 инструментов): у эталонных 2Б закрытие уходит за
  // уровень на 0.06-0.2 ATR, а хвост 0.4-0.5 — это уже состоявшийся уход,
  // возврата от которого ждать не приходится.
  maxCloseBeyondAtr: 0.35,
  // Тот же порог, что у проколов в quality.ts: меньше — это не пробой.
  minPierceAtr: 0.08,
  minCloseBeyondAtr: 0.05,
  minApproachNetMoveAtr: 1.5,
  minApproachBarsRatio: 1.2,
  approachWindow: 5,
  // «Дальний ретест». В разметке факторов far_retest начинается с 30 дней, но
  // для 2Б порог мягче по решению трейдера: 20 дней уже означает, что уровень
  // стоял нетронутым месяц торговых дней, а более жёсткие 30 отсекали
  // рабочие сетапы.
  minDaysSinceTouch: 20,
  accumulationRangeAtr: 1,
  accumulationWindow: 5,
  touchToleranceAtr: 0.3,
};

export type Break2bSide = "up" | "down";

export interface FalseBreakout2b {
  /** В какую сторону пробит уровень последним закрытым баром. */
  brokeSide: Break2bSide;
  /** Сторона сделки на завтра — против пробоя. */
  direction: "long" | "short";
  /** Насколько закрытие ушло за уровень, в ATR. */
  closeBeyondAtr: number;
  /** Насколько за уровень заходил хай/лоу пробойного бара, в ATR. */
  pierceAtr: number;
  /** Чистое смещение подхода, в ATR. */
  approachNetMoveAtr: number;
  /** Средний размах баров подхода к ATR. */
  approachBarsRatio: number;
  /** Сколько дней уровень не трогали до пробоя (Infinity — не трогали вовсе). */
  daysSinceTouch: number;
  /** Диапазон баров перед пробоем, в ATR — чем шире, тем «разгоннее» подход. */
  preBreakRangeAtr: number;
  /**
   * Сколько завтрашнему бару нужно пройти, чтобы вернуть цену за уровень —
   * ровно closeBeyondAtr плюс запас на сам возврат под уровень. Та самая
   * причина, по которой ЛП2Б реалистичнее обычного ЛП.
   */
  returnMoveAtr: number;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Сколько баров назад уровня в последний раз касались, считая от пробойного
 * бара (он сам — `candles.length - 1`). Infinity, если касаний не было.
 *
 * Бары САМОГО подхода (последние `skipRecent` перед пробоем) не считаются
 * касанием: разгон к уровню — часть этого же сетапа, и почти любой крупный
 * бар подхода попадает в допуск. Без этого «дальний ретест» не выполнялся бы
 * никогда — последний бар разгона всегда «трогал» уровень за день до пробоя.
 */
function daysSinceLastTouch(
  candles: DailyCandle[],
  levelPrice: number,
  tolerance: number,
  skipRecent: number,
): number {
  const breakIndex = candles.length - 1;
  for (let i = breakIndex - skipRecent; i >= 0; i--) {
    const c = candles[i];
    if (c.l - tolerance <= levelPrice && c.h + tolerance >= levelPrice) return breakIndex - i;
  }
  return Infinity;
}

/**
 * Есть ли на последнем ЗАКРЫТОМ баре заготовка под ЛП2Б. `candles` должны
 * заканчиваться этим баром (сегодняшний незакрытый отбрасывается выше по
 * стеку, см. dropUnclosedBar).
 */
export function detectFalseBreakout2b(
  candles: DailyCandle[],
  levelPrice: number,
  atr: number,
  th: FalseBreakout2bThresholds = DEFAULT_2B_THRESHOLDS,
): FalseBreakout2b | null {
  if (!(atr > 0) || candles.length < th.approachWindow + 2) return null;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  // Пробой должен быть СВЕЖИМ — сделанным именно последним баром: до него
  // цена закрывалась по другую сторону уровня. Иначе это не «первый бар
  // пробоя», а давно закрепившаяся за уровнем цена.
  const brokeUp = last.c > levelPrice && prev.c <= levelPrice;
  const brokeDown = last.c < levelPrice && prev.c >= levelPrice;
  if (!brokeUp && !brokeDown) return null;
  const brokeSide: Break2bSide = brokeUp ? "up" : "down";

  // Закрылись за уровнем, но недалеко — иначе это состоявшийся пробой.
  const closeBeyondAtr = Math.abs(last.c - levelPrice) / atr;
  if (closeBeyondAtr > th.maxCloseBeyondAtr || closeBeyondAtr < th.minCloseBeyondAtr) return null;

  // Уровень именно пробит: экстремум бара ушёл за него заметно.
  const pierceAtr = (brokeUp ? last.h - levelPrice : levelPrice - last.l) / atr;
  if (pierceAtr < th.minPierceAtr) return null;

  // Быстрый подход: длинное безоткатное движение либо крупные бары.
  const window = candles.slice(-th.approachWindow);
  const approachNetMoveAtr = Math.abs(last.c - window[0].o) / atr;
  const approachBarsRatio = mean(candles.slice(-3).map((c) => c.h - c.l)) / atr;
  if (approachNetMoveAtr < th.minApproachNetMoveAtr && approachBarsRatio < th.minApproachBarsRatio) return null;

  // Дальний ретест: до пробоя уровень должен был долго стоять нетронутым.
  const daysSinceTouch = daysSinceLastTouch(candles, levelPrice, atr * th.touchToleranceAtr, th.approachWindow);
  if (daysSinceTouch < th.minDaysSinceTouch) return null;

  // Накопления ПОД УРОВНЕМ быть не должно: поджатие вплотную к уровню — это
  // подготовка честного пробоя (конспект перечисляет накопление среди
  // обязательных условий именно для входа В пробой), а 2Б нужен подход с
  // разгона. Важны оба признака сразу — узкий коридор И его близость к
  // уровню: тихий боковик двумя ATR ниже это не «накопление под уровнем», а
  // просто затишье, из которого цена и прилетела одним баром.
  const preBreak = candles.slice(-(th.accumulationWindow + 1), -1);
  const preHigh = Math.max(...preBreak.map((c) => c.h));
  const preLow = Math.min(...preBreak.map((c) => c.l));
  const preBreakRangeAtr = (preHigh - preLow) / atr;
  const gapToLevelAtr = (brokeUp ? levelPrice - preHigh : preLow - levelPrice) / atr;
  if (preBreakRangeAtr <= th.accumulationRangeAtr && gapToLevelAtr <= th.accumulationRangeAtr) return null;

  return {
    brokeSide,
    // Возврат: пробили вверх — завтра работаем вниз, и наоборот.
    direction: brokeUp ? "short" : "long",
    closeBeyondAtr,
    pierceAtr,
    approachNetMoveAtr,
    approachBarsRatio,
    daysSinceTouch,
    preBreakRangeAtr,
    // Вернуть цену за уровень = пройти обратно то, что ушло за него, плюс
    // столько же на сам заход обратно (порог прокола с другой стороны).
    returnMoveAtr: closeBeyondAtr + th.minPierceAtr,
  };
}
