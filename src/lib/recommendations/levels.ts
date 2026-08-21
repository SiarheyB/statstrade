/**
 * levels.ts — детекция дневных ценовых уровней из OHLC-свечей (без стакана),
 * по методичке docs/trade/алгоритм.pdf и docs/trade/конспект.docx (торговый
 * алгоритм Герчика).
 *
 * Реализовано:
 *  - break_point     — точка излома тренда (fractal-пивоты, без проверки,
 *                      что цена реально их пробила — см. structure_break)
 *  - parabar         — уровень от паранормального бара (усиливает break_point)
 *  - structure_break — "злом" в терминах конспекта: fractal-пивот, который
 *                      ПОЗЖЕ был пробит закрытием — то есть подтверждённая
 *                      "зовнішня точка" структуры, а не случайный локальный
 *                      экстремум. Сильнее обычного break_point.
 *  - retracement     — "відкат": разворотная точка сразу после пробитого
 *                      (structure_break) экстремума противоположного знака —
 *                      конспект называет такие точки лучшими для входа.
 *  - mirror          — уровень, побывавший и сопротивлением, и поддержкой
 *  - historical      — старый, ещё не переподтверждённый уровень
 *  - gap             — границы ценового разрыва между барами
 *  - range_border    — верх/низ диапазона "від злому до відкату" (конспект):
 *                      берём цену слома и следующего отката как границы,
 *                      подтверждаем диапазон только если ОБЕ границы получили
 *                      минимум 2 касания до того, как цена закрылась за одной
 *                      из них.
 *  - local_stop      — "локальна ситуація" (конспект): недавняя опорная точка
 *                      (не обязана быть fractal-пивотом) + минимум 1 день
 *                      (шорт) / 2 дня (лонг) подтверждения рядом с ней без
 *                      глубокого пробоя. Не требует структурной истории —
 *                      только последние ~20 баров.
 *
 * Все уровни ограничены окном свежести: бар, образовавший уровень (БСУ),
 * должен лежать в последних FRESH_LEVEL_BARS барах — см. filterFreshLevels.
 */

export interface DailyCandle {
  t: number; // ms, открытие бара (UTC)
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number; // объём (base asset); опционален — не все источники его дают
}

export type LevelType =
  | "break_point"
  | "parabar"
  | "structure_break"
  | "retracement"
  | "mirror"
  | "historical"
  | "gap"
  | "range_border"
  | "local_stop";

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
  /**
   * БСУ — бар, образовавший уровень в его нынешнем виде. У схлопнутого
   * кластера это начало ПОСЛЕДНЕЙ серии образований, а не самое первое
   * появление цены в истории (см. mergeLevels).
   */
  formedAt: number;
  /** Самое первое появление уровня среди схлопнутых — «сколько он тут стоит». */
  firstFormedAt: number;
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
// НОРМАЛЬНЫМ барам. Паранормальный (конспект): >=1.5x или <=0.5x самого ATR.
//
// Окно НЕ фиксировано: если среди последних 5 баров попался паранормальный,
// берём шестой, седьмой и т.д., пока не наберётся ровно `lookback` нормальных
// — выброшенный бар не должен уменьшать выборку. Порог считается от самой
// оценки ATR, поэтому уточняем её итеративно: стартуем с МЕДИАНЫ ближнего
// окна (среднее для старта не годится — один паранормальный бар задирает его
// так, что нормальные бары уходят под порог 0.5x и выборка пустеет) и
// пересчитываем, пока состав выборки меняется
// (сходится за 2-3 шага; предел итераций — страховка от зацикливания на
// пограничном баре).
export function computeAtr(candles: DailyCandle[], lookback = 5, maxWindow = 30): number {
  if (candles.length === 0) return 0;
  const ranges = candles.slice(-maxWindow).map((c) => c.h - c.l);
  let est = median(ranges.slice(-Math.max(lookback * 2, 10)));
  if (est <= 0) return 0;
  for (let iter = 0; iter < 20; iter++) {
    const pool: number[] = [];
    for (let i = ranges.length - 1; i >= 0 && pool.length < lookback; i--) {
      const r = ranges[i];
      if (r >= 1.5 * est || r <= 0.5 * est) continue;
      pool.push(r);
    }
    // Нормальных не набралось даже в максимальном окне — инструмент целиком
    // «рваный». Берём что есть, лишь бы не вернуть ноль.
    if (pool.length === 0) return est;
    const next = mean(pool);
    if (next <= 0) return est;
    if (Math.abs(next - est) / est < 1e-9) return next;
    est = next;
  }
  return est;
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
      firstFormedAt: bar.t,
      lastTouchedAt: bar.t,
    });
  }
  return levels;
}

// Зигзаг из fractal-пивотов: схлопывает подряд идущие пивоты одного знака,
// оставляя более экстремальный — иначе на растущем тренде почти каждый бар
// с чуть более высоким хаем считался бы отдельным "пивотом", хотя реальная
// точка разворота структуры одна.
function buildZigzag(pivots: Pivot[]): Pivot[] {
  const zigzag: Pivot[] = [];
  for (const p of pivots) {
    const last = zigzag[zigzag.length - 1];
    if (!last) {
      zigzag.push(p);
      continue;
    }
    if (last.kind === p.kind) {
      const moreExtreme = p.kind === "high" ? p.price > last.price : p.price < last.price;
      if (moreExtreme) zigzag[zigzag.length - 1] = p;
    } else {
      zigzag.push(p);
    }
  }
  return zigzag;
}

export type TrendDirection = "up" | "down" | "range";

// Глобальный тренд — конспект: "Ліпше працювати ЛП по тренду". Первая версия
// сверяла строгую монотонность хаёв/лоёв по зигзагу, но это оказалось слишком
// хрупко на реальных данных: один смятый свинг или ровное касание (a === b)
// среди последних 6 точек — и весь тренд схлопывался в "range", даже когда
// на графике падение видно невооружённым глазом. Вместо этого сравниваем
// СРЕДНЮЮ цену первой и второй половины окна — устойчиво к шуму отдельных
// свечей и к точной форме коррекций, именно так трейдер и читает тренд "на
// глаз": где цена была раньше и где она в среднем сейчас.
export function detectTrend(candles: DailyCandle[], window = 60, minMoveAtr = 2): TrendDirection {
  if (candles.length < window) return "range";
  const recent = candles.slice(-window);
  const atr = computeAtr(candles, 5);
  if (atr <= 0) return "range";
  const mid = Math.floor(recent.length / 2);
  const earlyAvg = mean(recent.slice(0, mid).map((c) => c.c));
  const lateAvg = mean(recent.slice(mid).map((c) => c.c));
  const moveAtr = (lateAvg - earlyAvg) / atr;
  if (moveAtr >= minMoveAtr) return "up";
  if (moveAtr <= -minMoveAtr) return "down";
  return "range";
}

// "Зовнішні точки" по конспекту (docs/trade/конспект.docx, разделы "Рівні"):
// торговать нужно только структурные точки, которые цена реально пробила
// закрытием ("злом" — structure_break), а не любой локальный fractal-пивот —
// и точки разворота сразу после такого пробоя ("відкат" — retracement),
// особенно первый откат от начала движения и последний откат к текущей цене.
//
// Это делает то же самое, что break_point/parabar, но избирательнее: пивот
// без последующего пробоя закрытием остаётся только в break_point (может
// быть шумом), а зигзаг-пара "пробитый экстремум + следующая точка разворота"
// получает отдельные, более сильные типы.
function detectStructureLevels(candles: DailyCandle[], atr: number, wing = 3): DetectedLevel[] {
  const zigzag = buildZigzag(findPivots(candles, wing));
  const levels: DetectedLevel[] = [];

  for (let i = 0; i < zigzag.length; i++) {
    const p = zigzag[i];
    // "Злом" — импульсный пробой закрытием ПОЗЖЕ этого пивота (не хаем/лоу
    // следующего бара, а именно ценой закрытия — конспект: "обновлення
    // структури ЗАВЖДИ ціною закриття").
    let breakBarIndex = -1;
    for (let j = p.barIndex + 1; j < candles.length; j++) {
      const broke = p.kind === "high" ? candles[j].c > p.price : candles[j].c < p.price;
      if (broke) {
        breakBarIndex = j;
        break;
      }
    }
    if (breakBarIndex === -1) continue; // не подтверждён — остаётся просто break_point

    const bar = candles[p.barIndex];
    levels.push({
      price: p.price,
      type: "structure_break",
      strength: 3,
      touches: [{ barIndex: p.barIndex, t: bar.t, side: p.kind === "high" ? "resistance" : "support" }],
      formedAt: bar.t,
      firstFormedAt: bar.t,
      lastTouchedAt: candles[breakBarIndex].t,
    });

    // Откат — следующая точка зигзага противоположного знака: она хронологически
    // ложится МЕЖДУ пивотом и его пробоем (сначала откатили, потом на новом
    // движении пробили предыдущий экстремум закрытием) и по конспекту именно
    // эти точки (особенно ближайшая к текущей цене) — лучшие "зовнішні точки"
    // для входа. Пивот берём в расчёт только если его слом подтверждён —
    // иначе это может быть шум, а не настоящая точка структуры.
    const next = zigzag[i + 1];
    if (next && next.kind !== p.kind) {
      const retBar = candles[next.barIndex];
      levels.push({
        price: next.price,
        type: "retracement",
        strength: 3,
        touches: [{ barIndex: next.barIndex, t: retBar.t, side: next.kind === "high" ? "resistance" : "support" }],
        formedAt: retBar.t,
        firstFormedAt: retBar.t,
        lastTouchedAt: retBar.t,
      });
    }
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
    const at = candles[i].t;
    levels.push({ price: top, type: "gap", strength: 1, touches: [touch], formedAt: at, firstFormedAt: at, lastTouchedAt: at });
    levels.push({ price: bottom, type: "gap", strength: 1, touches: [touch], formedAt: at, firstFormedAt: at, lastTouchedAt: at });
  }
  return levels;
}

// Допуск "бар коснулся границы range", в ATR — как touchToleranceAtr в
// quality.ts. Минимум касаний, прежде чем считать диапазон подтверждённым —
// конспект: "Для проторговки нада хоча б два дотики одної з границь тоді
// можна назвати проторговку діапазоном".
const RANGE_TOUCH_TOLERANCE_ATR = 0.25;
const RANGE_MIN_TOUCHES = 2;

// Границы диапазона/проторговки — "від злому до відкату" (конспект): верх и
// низ range — это цена подтверждённого слома (structure_break-кандидат, тот
// же зигзаг, что и в detectStructureLevels) и цена следующего отката сразу
// после него, а НЕ произвольное скользящее окно. Диапазон засчитывается,
// только если ОБЕ границы получили минимум RANGE_MIN_TOUCHES касаний ДО того,
// как цена закрылась за одной из них (закрытие за границей — это уже новый
// слом/выход из диапазона, а не проторговка внутри него).
function detectRangeBorders(candles: DailyCandle[], atr: number, maxScanBars = 60, wing = 3): DetectedLevel[] {
  const levels: DetectedLevel[] = [];
  if (atr <= 0) return levels;
  const tolerance = atr * RANGE_TOUCH_TOLERANCE_ATR;
  const zigzag = buildZigzag(findPivots(candles, wing));

  for (let i = 0; i < zigzag.length - 1; i++) {
    const brk = zigzag[i];
    const ret = zigzag[i + 1];
    const top = brk.kind === "high" ? brk.price : ret.price;
    const bottom = brk.kind === "high" ? ret.price : brk.price;
    if (top <= bottom) continue;

    const scanEnd = Math.min(candles.length, ret.barIndex + 1 + maxScanBars);
    const topTouches: LevelTouch[] = [];
    const bottomTouches: LevelTouch[] = [];
    let lastBarIndex = ret.barIndex;

    for (let j = ret.barIndex + 1; j < scanEnd; j++) {
      const bar = candles[j];
      if (bar.c > top || bar.c < bottom) break; // закрылись за границей — диапазон закончился
      if (Math.abs(bar.h - top) <= tolerance) topTouches.push({ barIndex: j, t: bar.t, side: "resistance" });
      if (Math.abs(bar.l - bottom) <= tolerance) bottomTouches.push({ barIndex: j, t: bar.t, side: "support" });
      lastBarIndex = j;
    }

    if (topTouches.length < RANGE_MIN_TOUCHES || bottomTouches.length < RANGE_MIN_TOUCHES) continue;

    const brkBar = candles[brk.barIndex];
    const retBar = candles[ret.barIndex];
    const lastBar = candles[lastBarIndex];
    levels.push({
      // strength 3, не 2: подтверждено 2 касаниями с КАЖДОЙ стороны (сильнее
      // одностороннего local_stop c strength 2) — важно, чтобы при слиянии
      // близких уровней range_border не проигрывал local_stop выбор ЦЕНЫ
      // (mergeLevels берёт цену у самого сильного члена кластера).
      price: top,
      type: "range_border",
      strength: 3,
      touches: topTouches,
      formedAt: (brk.kind === "high" ? brkBar : retBar).t,
      firstFormedAt: (brk.kind === "high" ? brkBar : retBar).t,
      lastTouchedAt: lastBar.t,
    });
    levels.push({
      price: bottom,
      type: "range_border",
      strength: 3,
      touches: bottomTouches,
      formedAt: (brk.kind === "high" ? retBar : brkBar).t,
      firstFormedAt: (brk.kind === "high" ? retBar : brkBar).t,
      lastTouchedAt: lastBar.t,
    });
  }
  return levels;
}

// Допуск "неглубокий прокол" опорной точки и порог "глубокого" — как в
// quality.ts (minPierceAtr/deepFalseBreakoutAtr), но своя константа: local_stop
// не зависит от DEFAULT_THRESHOLDS, чтобы модуль уровней не тянул quality.ts.
const LOCAL_STOP_SHALLOW_TOLERANCE_ATR = 0.15;
const LOCAL_STOP_DEEP_ATR = 0.75;
const LOCAL_STOP_MAX_SHALLOW_PIERCES = 1;
// Насколько недавно должна была образоваться опорная точка, чтобы её вообще
// рассматривать как "локальну ситуацію" — конспект именно про недавние паузы
// цены, а не про историю многомесячной давности.
const LOCAL_STOP_LOOKBACK_BARS = 20;
// Сколько баров ПОСЛЕ опоры реально относятся к фазе накопления/подтверждения.
// Паттерн подтверждается за minConfirmDays (1-2 дня), а не обязан оставаться
// "рядом" вплоть до сегодняшнего бара — иначе уровень недельной давности
// наказывался бы за естественный снос цены за прошедшую неделю. Актуальность
// уровня для ТЕКУЩЕЙ цены — забота filterLevelsNearPrice ниже по пайплайну,
// не этого детектора.
const LOCAL_STOP_CONFIRM_WINDOW = 10;

// Опорная точка одной стороны (лоу для потенциального шорта, хай для
// потенциального лонга) + минимум `minConfirmDays` последующих баров (в
// пределах LOCAL_STOP_CONFIRM_WINDOW), которые не смогли уйти далеко за неё.
// НЕ требует, чтобы опорный бар был fractal-пивотом (findPivots его не
// найдёт, если рядом есть более глубокий экстремум — опорная точка это
// просто пауза цены, а не крайняя точка колебания).
function checkLocalStop(
  candles: DailyCandle[],
  anchorIndex: number,
  atr: number,
  kind: "low" | "high",
  minConfirmDays: number,
): DetectedLevel | null {
  const anchor = candles[anchorIndex];
  const levelPrice = kind === "low" ? anchor.l : anchor.h;
  const confirmBars = candles.slice(anchorIndex + 1, anchorIndex + 1 + LOCAL_STOP_CONFIRM_WINDOW);
  if (confirmBars.length < minConfirmDays) return null;

  // Опора должна быть реальной точкой ПАУЗЫ, а не любым баром посреди
  // ровного тренда или плоского участка: в монотонном движении почти каждый
  // бар формально "не пробивается" следующим, а на плоском участке у каждого
  // бара одинаковый хай/лоу — без строгого сравнения (не "<=", а именно "<")
  // каждый бар плато отдельно переизбирался бы опорой, размножая почти
  // идентичные уровни. Требуем, чтобы бар СТРОГО ДО этого был на новом
  // экстремуме (движение только что затормозило именно тут, а не раньше/уже).
  if (anchorIndex > 0) {
    const prev = candles[anchorIndex - 1];
    if (kind === "low" && prev.l <= anchor.l) return null;
    if (kind === "high" && prev.h >= anchor.h) return null;
  }

  const shallowTolerance = atr * LOCAL_STOP_SHALLOW_TOLERANCE_ATR;
  const deepThreshold = atr * LOCAL_STOP_DEEP_ATR;
  // Проверку "не ушли ли далеко" НЕ делаем по фиксированному ATR-допуску:
  // однодневный ATR не годится множителем на многодневный снос цены — за
  // неделю нормального накопления волатильная монета вполне может отойти на
  // несколько ATR от опоры, оставаясь при этом валидной "локальною ситуацією"
  // (конспект прямо описывает такое поведение). Актуальность уровня для
  // ТЕКУЩЕЙ цены и так проверяет filterLevelsNearPrice ниже по пайплайну —
  // здесь достаточно, что опора не была пробита ЗАКРЫТИЕМ (deepThreshold).
  const touches: LevelTouch[] = [];
  let shallowPierces = 0;

  for (let i = 0; i < confirmBars.length; i++) {
    const bar = confirmBars[i];
    const barIndex = anchorIndex + 1 + i;
    if (kind === "low") {
      if (bar.c < levelPrice - deepThreshold) return null; // глубокий пробой ЗАКРЫТИЕМ — опора не удержалась
      // Глубокий прокол ХВОСТОМ отменяет опору даже при закрытии обратно у
      // уровня: хвост в 1×ATR и больше — это не "неглибокий ЛП" (конспект:
      // до 10-15% ATR), а по сути неудержание опоры, которое лишь случайно
      // закрылось близко. Без этой проверки бар с хвостом в несколько ATR
      // засчитывался бы как один рядовой "неглубокий прокол".
      if (bar.l < levelPrice - deepThreshold) return null;
      if (bar.l < levelPrice - shallowTolerance) shallowPierces += 1;
    } else {
      if (bar.c > levelPrice + deepThreshold) return null;
      if (bar.h > levelPrice + deepThreshold) return null;
      if (bar.h > levelPrice + shallowTolerance) shallowPierces += 1;
    }
    touches.push({ barIndex, t: bar.t, side: kind === "low" ? "support" : "resistance" });
  }
  if (shallowPierces > LOCAL_STOP_MAX_SHALLOW_PIERCES) return null;

  const lastBar = confirmBars[confirmBars.length - 1];
  return {
    price: levelPrice,
    type: "local_stop",
    strength: 2,
    touches,
    formedAt: anchor.t,
    firstFormedAt: anchor.t,
    lastTouchedAt: lastBar.t,
  };
}

// "Локальна ситуація" (конспект, "Домашка рівні"/"Домашка структура"):
// зупинка ціни + 1 день (шорт) / 2 дні (лонг) закриваються рядом, без
// глибокого пробою — этого достаточно, чтобы торговать сетап, НЕ дожидаясь
// полноценного структурного уровня. Направление 1-день/2-дня определяется
// стороной будущего пробоя (лоу-опора → пробой вниз → шорт → 1 день; хай-опора
// → пробой вверх → лонг → 2 дня), а не тем, какая это сторона свечи.
function detectLocalStops(candles: DailyCandle[], atr: number, lookbackBars = LOCAL_STOP_LOOKBACK_BARS): DetectedLevel[] {
  const levels: DetectedLevel[] = [];
  if (atr <= 0 || candles.length < 4) return levels;
  const start = Math.max(0, candles.length - 1 - lookbackBars);
  for (let i = start; i < candles.length - 1; i++) {
    const short = checkLocalStop(candles, i, atr, "low", 1);
    if (short) levels.push(short);
    const long = checkLocalStop(candles, i, atr, "high", 2);
    if (long) levels.push(long);
  }
  return levels;
}

// Схлопывает уровни с близкой ценой (в пределах tolerance*ATR) в один,
// суммируя касания и силу. Тип результата — тип с наибольшей "специфичностью"
// среди схлопнутых (retracement/structure_break сильнее общего break_point).
// range_border стоит ВЫШЕ break_point: граница диапазона с 2 подтверждёнными
// касаниями (см. detectRangeBorders) — более специфичная классификация того
// же самого пивота, чем голый break_point, и не должна теряться при мёрдже.
// mirror/historical сюда не попадают физически (их назначает только
// reclassifyMirrorHistorical ПОСЛЕ merge) — их место в таблице формальность
// ради exhaustiveness Record<LevelType, …>.
// Разрыв между образованиями одной и той же линии, после которого это уже
// новый эпизод, а не продолжение прежнего: те же 10 баров, которыми меряется
// «свежесть» пробоя в breakoutSignals.
const REGROUP_GAP_BARS = 10;

const TYPE_PRIORITY: Record<LevelType, number> = {
  retracement: 9,
  structure_break: 8,
  parabar: 7,
  range_border: 6,
  local_stop: 5,
  mirror: 4,
  gap: 3,
  historical: 2,
  break_point: 1,
};

export function mergeLevels(
  rawLevels: DetectedLevel[],
  atr: number,
  toleranceAtrFrac = 0.15,
  regroupGapBars = REGROUP_GAP_BARS,
): DetectedLevel[] {
  if (rawLevels.length === 0) return [];
  const tolerance = atr > 0 ? atr * toleranceAtrFrac : Math.abs(mean(rawLevels.map((l) => l.price))) * 0.001;
  const sorted = [...rawLevels].sort((a, b) => a.price - b.price);
  const merged: DetectedLevel[] = [];
  let bucket: DetectedLevel[] = [sorted[0]];
  const flush = () => {
    // Цена схлопнутого уровня — НЕ среднее по кластеру: конспект требует
    // "адаптувати рівень по найбільшій кількості дотиків" (или по самому
    // сильному подтверждению), а не размывать его в точку, которой на
    // графике может не быть вовсе. Берём цену самого сильного члена
    // кластера (при равенстве — с наибольшим числом касаний).
    const anchor = bucket.reduce((best, l) => {
      if (l.strength > best.strength) return l;
      if (l.strength === best.strength && l.touches.length > best.touches.length) return l;
      return best;
    }, bucket[0]);
    const price = anchor.price;
    const touches = bucket.flatMap((l) => l.touches);
    const type = bucket.reduce((best, l) => (TYPE_PRIORITY[l.type] > TYPE_PRIORITY[best] ? l.type : best), bucket[0].type);
    const strength = bucket.reduce((sum, l) => sum + l.strength, 0);
    // БСУ — начало ПОСЛЕДНЕЙ серии образований в кластере, а не самое раннее
    // из них. Одна и та же цена может отработать несколькими эпизодами,
    // разнесёнными на недели: у ZHIPUUSDT опора 126.50 сложилась 06.08, потом
    // цена ушла на 181 и вернулась — опору 18-20.08 трейдер считает от 18.08,
    // а не от августовского эпизода двухнедельной давности. Серию рвёт
    // разрыв больше `regroupGapBars` баров между образованиями.
    const byBar = [...bucket].sort((a, b) => (a.touches[0]?.barIndex ?? 0) - (b.touches[0]?.barIndex ?? 0));
    let seriesStart = byBar.length - 1;
    while (seriesStart > 0) {
      const gap = (byBar[seriesStart].touches[0]?.barIndex ?? 0) - (byBar[seriesStart - 1].touches[0]?.barIndex ?? 0);
      if (gap > regroupGapBars) break;
      seriesStart -= 1;
    }
    const formedAt = Math.min(...byBar.slice(seriesStart).map((l) => l.formedAt));
    const firstFormedAt = Math.min(...bucket.map((l) => l.firstFormedAt ?? l.formedAt));
    const lastTouchedAt = Math.max(...bucket.map((l) => l.lastTouchedAt));
    merged.push({ price, type, strength, touches, formedAt, firstFormedAt, lastTouchedAt });
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
  if (level.type === "gap" || level.type === "range_border" || level.type === "local_stop") return level;
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

/**
 * Оставляет уровни, чей БСУ попал в последние `bars` баров. Возраст меряем
 * барами, а не календарём: у истории может быть дыра (пара листнута позже,
 * биржа не отдала день), и «180 дней назад» тогда указывало бы не туда.
 * `bars <= 0` — фильтр выключен (нужно тестам и разбору старых картин).
 */
export function filterFreshLevels(levels: DetectedLevel[], candles: DailyCandle[], bars: number): DetectedLevel[] {
  if (bars <= 0 || candles.length === 0) return levels;
  const cutoff = candles[Math.max(0, candles.length - bars)].t;
  return levels.filter((l) => l.formedAt >= cutoff);
}

export interface DetectLevelsOptions {
  pivotWing?: number;
  atrLookback?: number;
  mergeToleranceAtrFrac?: number;
  /** Сколько баров после отката сканировать в поисках 2 касаний каждой
   *  границы диапазона, прежде чем сдаться (см. detectRangeBorders). */
  rangeBorderWindow?: number;
  /** Окно свежести БСУ, баров (см. FRESH_LEVEL_BARS). 0 — не ограничивать. */
  freshnessBars?: number;
}

// Окно свежести: бар, образовавший уровень (БСУ), должен лежать в последних
// FRESH_LEVEL_BARS барах — полгода календарных дней, крипта торгуется без
// выходных. Торгуем то, что рынок помнит: линия годичной давности формально
// набирает касания и силу, но к сегодняшнему дню это уже история, а не
// рабочий уровень.
//
// Фильтр стоит ДО mergeLevels намеренно. После merge у кластера formedAt —
// самый ранний БСУ среди слитых уровней, поэтому свежий уровень, у которого
// когда-то давно рядом был пивот, выглядел бы «уровнем годичной давности» и
// тащил бы за собой чужую силу: так у ONGUSDT линия 0.087 набрала силу 23 из
// 14 касаний за девять месяцев и БСУ 21.11.2025, перебив по score свежие
// апрельские откаты рядом с ценой.
const FRESH_LEVEL_BARS = 180;

// Главная точка входа: считает ATR, находит все типы уровней, отбрасывает
// несвежие, схлопывает близкие и переклассифицирует в mirror/historical по
// истории касаний.
export function detectLevels(candles: DailyCandle[], opts: DetectLevelsOptions = {}): DetectedLevel[] {
  if (candles.length < 20) return [];
  const atr = computeAtr(candles, opts.atrLookback ?? 5);
  const raw = [
    ...detectBreakPoints(candles, atr, opts.pivotWing ?? 3),
    ...detectStructureLevels(candles, atr, opts.pivotWing ?? 3),
    ...detectGaps(candles, atr),
    ...detectRangeBorders(candles, atr, opts.rangeBorderWindow ?? 60, opts.pivotWing ?? 3),
    ...detectLocalStops(candles, atr),
  ];
  const fresh = filterFreshLevels(raw, candles, opts.freshnessBars ?? FRESH_LEVEL_BARS);
  const merged = mergeLevels(fresh, atr, opts.mergeToleranceAtrFrac ?? 0.15);
  const nowMs = candles[candles.length - 1].t;
  return merged.map((l) => reclassifyMirrorHistorical(l, candles, nowMs));
}

// Уровни в пределах `maxDistanceAtr` от текущей цены — "картинка для
// торговли сегодня". Сортировка: сначала ближе к цене, при равенстве — сильнее.
//
// «Близость» меряется от БЛИЖАЙШЕЙ границы последнего закрытого бара (хай для
// уровня сверху, лоу для уровня снизу), а не от цены закрытия: подход к
// уровню — это то, докуда бар дотянулся, и весь остальной разбор (approachGap
// в quality.ts, касания, проколы) считает именно так. По закрытию уровень
// уезжал «далеко» ровно на длину последней свечи: у WENUSDT хай паранормального
// бара 12.08 (9.33) оказывался в 1.97×ATR от закрытия 8.77 и выпадал из
// разбора, хотя вчерашний бар не дотянул до него 1.27×ATR — и вместо
// параБАРа сетап строился по местной опоре силы 2.
//
// lastBar опционален: без него меряем по-старому, от цены закрытия.
export function filterLevelsNearPrice(
  levels: DetectedLevel[],
  currentPrice: number,
  atr: number,
  maxDistanceAtr = 1.5,
  lastBar?: DailyCandle,
): DetectedLevel[] {
  if (atr <= 0) return [];
  // Бар, уже проколовший уровень, даёт отрицательный разрыв — считаем его
  // нулевым: ближе, чем «дотянулись», не бывает.
  const approachGap = (levelPrice: number): number => {
    if (!lastBar) return Math.abs(levelPrice - currentPrice);
    return levelPrice >= currentPrice
      ? Math.max(0, levelPrice - lastBar.h)
      : Math.max(0, lastBar.l - levelPrice);
  };
  return levels
    .map((l) => ({ level: l, distanceAtr: approachGap(l.price) / atr }))
    .filter((x) => x.distanceAtr <= maxDistanceAtr)
    .sort((a, b) => a.distanceAtr - b.distanceAtr || b.level.strength - a.level.strength)
    .map((x) => x.level);
}
