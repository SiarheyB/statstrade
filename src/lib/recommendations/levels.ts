/**
 * levels.ts — детекция дневных ценовых уровней из OHLC-свечей (без стакана),
 * по методичке docs/trade/алгоритм.pdf (торговый алгоритм Герчика).
 *
 * Реализовано в этом первом проходе (см. TRADE_RECOMMENDATIONS_PLAN.md):
 *  - break_point   — точка излома тренда (fractal-пивоты)
 *  - parabar       — уровень от паранормального бара (усиливает break_point)
 *  - mirror        — уровень, побывавший и сопротивлением, и поддержкой
 *  - historical     — старый, ещё не переподтверждённый уровень
 *  - gap           — границы ценового разрыва между барами
 *  - range_border  — верх/низ узкой многобарной консолидации
 *
 * Сознательно ОТЛОЖЕНО (см. план, п.0): "граница отката" и "проторговка" —
 * требуют более тонкого трекинга состояния тренда, чтобы не выдавать
 * недостоверную классификацию без валидации на реальных данных.
 */

export interface DailyCandle {
  t: number; // ms, открытие бара (UTC)
  o: number;
  h: number;
  l: number;
  c: number;
}

export type LevelType =
  | "break_point"
  | "parabar"
  | "mirror"
  | "historical"
  | "gap"
  | "range_border";

export interface LevelTouch {
  barIndex: number;
  t: number;
  side: "resistance" | "support"; // подошли снизу (сопротивление) или сверху (поддержка)
}

export interface DetectedLevel {
  price: number;
  type: LevelType;
  strength: number;
  touches: LevelTouch[];
  formedAt: number;
  lastTouchedAt: number;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ATR — хай минус лоу дневного бара, среднее по последним `lookback`
// "нормальным" барам (без паранормальных: >=1.5x или <=0.5x базовой оценки).
// Базовая оценка — медиана диапазонов в чуть более широком окне (устойчива
// к выбросам сама по себе, не нужен отдельный "предварительный ATR").
export function computeAtr(candles: DailyCandle[], lookback = 5): number {
  if (candles.length === 0) return 0;
  const window = candles.slice(-Math.max(lookback + 5, 10));
  const ranges = window.map((c) => c.h - c.l);
  const baseline = median(ranges);
  if (baseline <= 0) return mean(candles.slice(-lookback).map((c) => c.h - c.l));
  const normal = ranges.filter((r) => r <= baseline * 1.5 && r >= baseline * 0.5);
  const pool = normal.length > 0 ? normal : ranges;
  return mean(pool.slice(-lookback)) || baseline;
}

export function isParanormalBar(candle: DailyCandle, atr: number): boolean {
  if (atr <= 0) return false;
  return candle.h - candle.l >= 2 * atr;
}

interface Pivot {
  barIndex: number;
  price: number;
  kind: "high" | "low";
}

// Fractal-пивоты: хай/лоу бара — экстремум в окне [i-wing, i+wing].
// Строгая уникальность (> / <, не >=/<=) относительно СОСЕДЕЙ (без самого
// бара) — иначе на плоских участках (несколько баров с одинаковым хаем/лоу)
// каждый из них ложно засчитывается отдельным пивотом.
function findPivots(candles: DailyCandle[], wing = 3): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = wing; i < candles.length - wing; i++) {
    const neighbors = [...candles.slice(i - wing, i), ...candles.slice(i + 1, i + wing + 1)];
    const h = candles[i].h;
    const l = candles[i].l;
    if (h > Math.max(...neighbors.map((c) => c.h))) {
      pivots.push({ barIndex: i, price: h, kind: "high" });
    }
    if (l < Math.min(...neighbors.map((c) => c.l))) {
      pivots.push({ barIndex: i, price: l, kind: "low" });
    }
  }
  return pivots;
}

// Точка излома + от параБАРа: по каждому пивоту строим кандидата на уровень.
// Усиление: экстремум за последние ~6 мес. (126 торговых баров), паранормальный
// формирующий бар (тогда тип сразу "parabar" — это более специфичная и
// сильная классификация, перекрывает базовый break_point).
function detectBreakPoints(candles: DailyCandle[], atr: number, wing = 3): DetectedLevel[] {
  const pivots = findPivots(candles, wing);
  const HALF_YEAR_BARS = 126;
  const levels: DetectedLevel[] = [];
  for (const p of pivots) {
    const bar = candles[p.barIndex];
    const windowStart = Math.max(0, p.barIndex - HALF_YEAR_BARS);
    const windowSlice = candles.slice(windowStart, p.barIndex + 1);
    const isExtreme =
      p.kind === "high"
        ? p.price >= Math.max(...windowSlice.map((c) => c.h))
        : p.price <= Math.min(...windowSlice.map((c) => c.l));
    const paranormal = isParanormalBar(bar, atr);
    let strength = 1;
    if (isExtreme) strength += 1;
    if (paranormal) strength += 1;
    levels.push({
      price: p.price,
      type: paranormal ? "parabar" : "break_point",
      strength,
      touches: [{ barIndex: p.barIndex, t: bar.t, side: p.kind === "high" ? "resistance" : "support" }],
      formedAt: bar.t,
      lastTouchedAt: bar.t,
    });
  }
  return levels;
}

// GAP — границы ценового разрыва между закрытием предыдущего и открытием
// текущего бара, если разрыв заметен относительно ATR.
function detectGaps(candles: DailyCandle[], atr: number, minGapAtrFrac = 0.3): DetectedLevel[] {
  const levels: DetectedLevel[] = [];
  if (atr <= 0) return levels;
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].c;
    const openT = candles[i].o;
    const gap = openT - prevClose;
    if (Math.abs(gap) < atr * minGapAtrFrac) continue;
    const top = Math.max(prevClose, openT);
    const bottom = Math.min(prevClose, openT);
    const touch: LevelTouch = {
      barIndex: i,
      t: candles[i].t,
      side: gap > 0 ? "support" : "resistance",
    };
    levels.push({ price: top, type: "gap", strength: 1, touches: [touch], formedAt: candles[i].t, lastTouchedAt: candles[i].t });
    levels.push({ price: bottom, type: "gap", strength: 1, touches: [touch], formedAt: candles[i].t, lastTouchedAt: candles[i].t });
  }
  return levels;
}

// Граница накопления/range — верх/низ окна из `windowSize` баров, чей общий
// диапазон (max high - min low) укладывается в `maxRangeAtrFrac` от ATR.
function detectRangeBorders(candles: DailyCandle[], atr: number, windowSize = 10, maxRangeAtrFrac = 1.2): DetectedLevel[] {
  const levels: DetectedLevel[] = [];
  if (atr <= 0 || candles.length < windowSize) return levels;
  for (let i = 0; i <= candles.length - windowSize; i++) {
    const windowSlice = candles.slice(i, i + windowSize);
    const hi = Math.max(...windowSlice.map((c) => c.h));
    const lo = Math.min(...windowSlice.map((c) => c.l));
    if (hi - lo > atr * maxRangeAtrFrac) continue;
    const lastBar = windowSlice[windowSlice.length - 1];
    levels.push({
      price: hi,
      type: "range_border",
      strength: 1,
      touches: [{ barIndex: i + windowSize - 1, t: lastBar.t, side: "resistance" }],
      formedAt: windowSlice[0].t,
      lastTouchedAt: lastBar.t,
    });
    levels.push({
      price: lo,
      type: "range_border",
      strength: 1,
      touches: [{ barIndex: i + windowSize - 1, t: lastBar.t, side: "support" }],
      formedAt: windowSlice[0].t,
      lastTouchedAt: lastBar.t,
    });
  }
  return levels;
}

// Схлопывает уровни с близкой ценой (в пределах tolerance*ATR) в один,
// суммируя касания и силу. Тип результата — тип с наибольшей "специфичностью"
// среди схлопнутых (parabar/gap сильнее общего break_point/range_border).
const TYPE_PRIORITY: Record<LevelType, number> = {
  parabar: 5,
  mirror: 4,
  gap: 3,
  historical: 2,
  break_point: 1,
  range_border: 0,
};

export function mergeLevels(rawLevels: DetectedLevel[], atr: number, toleranceAtrFrac = 0.15): DetectedLevel[] {
  if (rawLevels.length === 0) return [];
  const tolerance = atr > 0 ? atr * toleranceAtrFrac : Math.abs(mean(rawLevels.map((l) => l.price))) * 0.001;
  const sorted = [...rawLevels].sort((a, b) => a.price - b.price);
  const merged: DetectedLevel[] = [];
  let bucket: DetectedLevel[] = [sorted[0]];
  const flush = () => {
    const price = mean(bucket.map((l) => l.price));
    const touches = bucket.flatMap((l) => l.touches);
    const type = bucket.reduce((best, l) => (TYPE_PRIORITY[l.type] > TYPE_PRIORITY[best] ? l.type : best), bucket[0].type);
    const strength = bucket.reduce((sum, l) => sum + l.strength, 0);
    const formedAt = Math.min(...bucket.map((l) => l.formedAt));
    const lastTouchedAt = Math.max(...bucket.map((l) => l.lastTouchedAt));
    merged.push({ price, type, strength, touches, formedAt, lastTouchedAt });
  };
  for (let i = 1; i < sorted.length; i++) {
    const prevPrice = bucket[bucket.length - 1].price;
    if (Math.abs(sorted[i].price - prevPrice) <= tolerance) {
      bucket.push(sorted[i]);
    } else {
      flush();
      bucket = [sorted[i]];
    }
  }
  flush();
  return merged;
}

// Зеркальный/исторический: смотрим, как цена вела себя ПОСЛЕ каждого касания
// уровня — закрытие следующих баров ниже уровня помечает касание как
// "сопротивление", выше — как "поддержка". Если среди касаний есть оба вида —
// уровень "зеркальный". Если единственное касание давностью более 30 дней —
// "исторический" (ещё не переподтверждён). Иначе тип не меняется
// (break_point/parabar уже присвоены в detectBreakPoints).
function reclassifyMirrorHistorical(level: DetectedLevel, candles: DailyCandle[], nowMs: number): DetectedLevel {
  if (level.type === "gap" || level.type === "range_border") return level;
  const sides = new Set<"resistance" | "support">();
  for (const touch of level.touches) {
    const after = candles.slice(touch.barIndex + 1, touch.barIndex + 4);
    if (after.length === 0) continue;
    const avgClose = mean(after.map((c) => c.c));
    sides.add(avgClose < level.price ? "resistance" : "support");
  }
  if (sides.size >= 2) {
    return { ...level, type: "mirror", strength: level.strength + 1 };
  }
  const DAY_MS = 86_400_000;
  const isOld = nowMs - level.lastTouchedAt > 30 * DAY_MS;
  if (level.touches.length === 1 && isOld && level.type === "break_point") {
    return { ...level, type: "historical" };
  }
  return level;
}

export interface DetectLevelsOptions {
  pivotWing?: number;
  atrLookback?: number;
  mergeToleranceAtrFrac?: number;
  rangeBorderWindow?: number;
}

// Главная точка входа: считает ATR, находит все типы уровней, схлопывает
// близкие и переклассифицирует в mirror/historical по истории касаний.
export function detectLevels(candles: DailyCandle[], opts: DetectLevelsOptions = {}): DetectedLevel[] {
  if (candles.length < 20) return [];
  const atr = computeAtr(candles, opts.atrLookback ?? 5);
  const raw = [
    ...detectBreakPoints(candles, atr, opts.pivotWing ?? 3),
    ...detectGaps(candles, atr),
    ...detectRangeBorders(candles, atr, opts.rangeBorderWindow ?? 10),
  ];
  const merged = mergeLevels(raw, atr, opts.mergeToleranceAtrFrac ?? 0.15);
  const nowMs = candles[candles.length - 1].t;
  return merged.map((l) => reclassifyMirrorHistorical(l, candles, nowMs));
}

// Уровни в пределах `maxDistanceAtr` от текущей цены — "картинка для
// торговли сегодня". Сортировка: сначала ближе к цене, при равенстве — сильнее.
export function filterLevelsNearPrice(
  levels: DetectedLevel[],
  currentPrice: number,
  atr: number,
  maxDistanceAtr = 1.5,
): DetectedLevel[] {
  if (atr <= 0) return [];
  return levels
    .map((l) => ({ level: l, distanceAtr: Math.abs(l.price - currentPrice) / atr }))
    .filter((x) => x.distanceAtr <= maxDistanceAtr)
    .sort((a, b) => a.distanceAtr - b.distanceAtr || b.level.strength - a.level.strength)
    .map((x) => x.level);
}
