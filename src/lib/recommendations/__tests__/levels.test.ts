import { describe, it, expect } from "vitest";
import {
  computeAtr,
  isParanormalBar,
  detectLevels,
  detectTrend,
  mergeLevels,
  filterLevelsNearPrice,
  type DailyCandle,
  type DetectedLevel,
} from "../levels";

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 0, 1);

function candle(dayOffset: number, o: number, h: number, l: number, c: number): DailyCandle {
  return { t: START + dayOffset * DAY_MS, o, h, l, c };
}

// Плоские бары фиксированного диапазона — база для ATR/фона без сигналов.
function flatSeries(count: number, price: number, range = 2): DailyCandle[] {
  return Array.from({ length: count }, (_, i) => candle(i, price, price + range / 2, price - range / 2, price));
}

describe("computeAtr", () => {
  it("averages normal bar ranges", () => {
    const candles = flatSeries(10, 100, 4); // range=4 each
    expect(computeAtr(candles, 5)).toBeCloseTo(4, 5);
  });

  it("excludes paranormal outlier bars from the average", () => {
    const candles = flatSeries(9, 100, 4);
    candles.push(candle(9, 100, 130, 70, 110)); // range=60, way above baseline
    const atr = computeAtr(candles, 5);
    expect(atr).toBeCloseTo(4, 5);
  });

  // Конспект: выброшенный паранормальный бар не сокращает выборку — вместо
  // него берётся ещё один бар глубже, чтобы нормальных всё равно было пять.
  it("widens the window so `lookback` NORMAL bars are always averaged", () => {
    // 5 старых баров по 4, затем паранормальный, затем 4 бара по 6.
    const candles = flatSeries(5, 100, 4);
    candles.push(candle(5, 100, 130, 70, 110)); // паранормальный, range=60
    for (let i = 0; i < 4; i++) candles.push(candle(6 + i, 100, 103, 97, 100)); // range=6
    // Без расширения усреднились бы только четыре шестёрки -> 6.
    // С расширением берётся ещё и четвёрка из-за паранормального: (6*4+4)/5.
    expect(computeAtr(candles, 5)).toBeCloseTo((6 * 4 + 4) / 5, 5);
  });

  // Затухание волатильности: слишком МАЛЫЙ бар (<=0.5 ATR) тоже паранормальный
  // и тоже выбрасывается — на нём ATR не занижается.
  it("drops bars that are too small (<= 0.5x ATR), not just too big", () => {
    const candles = flatSeries(9, 100, 10);
    candles.push(candle(9, 100, 100.5, 99.5, 100)); // range=1, это 0.1 ATR
    expect(computeAtr(candles, 5)).toBeCloseTo(10, 5);
  });
});

describe("isParanormalBar", () => {
  it("flags bars with range >= 2x ATR", () => {
    const atr = 5;
    expect(isParanormalBar(candle(0, 100, 111, 100, 110), atr)).toBe(true); // range=11
    expect(isParanormalBar(candle(0, 100, 105, 100, 103), atr)).toBe(false); // range=5
  });
});

describe("detectLevels — break_point / parabar", () => {
  it("finds a swing high as a break_point level", () => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < 15; i++) candles.push(candle(i, 100 + i, 101 + i, 99 + i, 100 + i)); // uptrend
    candles.push(candle(15, 115, 120, 114, 116)); // pivot high at 120
    for (let i = 16; i < 30; i++) candles.push(candle(i, 116 - (i - 15), 117 - (i - 15), 115 - (i - 15), 116 - (i - 15))); // downtrend after

    const levels = detectLevels(candles);
    const hit = levels.find((l) => Math.abs(l.price - 120) < 0.01);
    expect(hit).toBeDefined();
    expect(["break_point", "parabar", "mirror", "historical"]).toContain(hit!.type);
  });

  it("classifies a pivot formed by a paranormal bar as parabar", () => {
    const candles: DailyCandle[] = flatSeries(10, 100, 2);
    // Огромный бар посреди плоского фона — паранормальный, формирует пик.
    candles.push(candle(10, 100, 140, 99, 138));
    candles.push(...Array.from({ length: 10 }, (_, i) => candle(11 + i, 100, 101, 99, 100)));

    const levels = detectLevels(candles, { pivotWing: 3 });
    const parabar = levels.find((l) => l.type === "parabar");
    expect(parabar).toBeDefined();
    expect(parabar!.price).toBeCloseTo(140, 5);
  });
});

describe("detectLevels — structure_break / retracement", () => {
  it("promotes a broken pivot high to structure_break and the pullback low to retracement", () => {
    // Пивот-хай (i=6, h=126), откат к пивот-лоу (i=10, l=106), затем новый
    // рост, закрытие которого пробивает 126 (i=15, c=128) — классический
    // "злом + відкат" из конспекта.
    const rows: [number, number, number, number][] = [
      [99, 102, 98, 100], // 0
      [103, 106, 102, 104],
      [107, 110, 106, 108],
      [111, 114, 110, 112],
      [115, 118, 114, 116],
      [119, 122, 118, 120],
      [123, 126, 122, 124], // 6 — pivot high
      [119, 122, 118, 120],
      [115, 118, 114, 116],
      [111, 114, 110, 112],
      [107, 110, 106, 108], // 10 — pivot low
      [111, 114, 110, 112],
      [115, 118, 114, 116],
      [119, 122, 118, 120],
      [123, 126, 122, 124],
      [127, 130, 126, 128], // 15 — close (128) breaks the i=6 pivot high (126)
      [129, 132, 128, 130],
      [131, 134, 130, 132],
      [133, 136, 132, 134],
      [135, 138, 134, 136],
      [137, 140, 136, 138],
      [139, 142, 138, 140],
      [141, 144, 140, 142],
      [143, 146, 142, 144],
    ];
    const candles: DailyCandle[] = rows.map(([o, h, l, c], i) => candle(i, o, h, l, c));

    const levels = detectLevels(candles);
    const structureBreak = levels.find((l) => l.type === "structure_break" && Math.abs(l.price - 126) < 0.01);
    const retracement = levels.find((l) => l.type === "retracement" && Math.abs(l.price - 106) < 0.01);
    expect(structureBreak).toBeDefined();
    expect(retracement).toBeDefined();
  });

  it("does not classify an unbroken pivot as structure_break", () => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < 15; i++) candles.push(candle(i, 100 + i, 101 + i, 99 + i, 100 + i)); // uptrend
    candles.push(candle(15, 115, 120, 114, 116)); // pivot high at 120, never broken afterwards
    for (let i = 16; i < 30; i++) candles.push(candle(i, 116 - (i - 15), 117 - (i - 15), 115 - (i - 15), 116 - (i - 15))); // downtrend after

    const levels = detectLevels(candles);
    const structureBreak = levels.find((l) => l.type === "structure_break" && Math.abs(l.price - 120) < 0.01);
    expect(structureBreak).toBeUndefined();
  });
});

describe("detectLevels — gap", () => {
  it("detects a gap between prev close and next open beyond ATR threshold", () => {
    const candles = flatSeries(10, 100, 2); // ATR ~= 2
    // Разрыв вверх: prevClose=100, next open=110 — далеко больше 0.3*ATR
    candles.push(candle(10, 110, 112, 109, 111));
    candles.push(...flatSeries(10, 111, 2).map((c, i) => candle(11 + i, c.o, c.h, c.l, c.c)));

    const levels = detectLevels(candles);
    const gapLevels = levels.filter((l) => l.type === "gap");
    expect(gapLevels.length).toBeGreaterThan(0);
    const prices = gapLevels.map((l) => l.price);
    expect(prices.some((p) => Math.abs(p - 100) < 0.5)).toBe(true);
    expect(prices.some((p) => Math.abs(p - 110) < 0.5)).toBe(true);
  });
});

describe("detectLevels — range_border", () => {
  // Слом (пивот-хай 110) + откат (пивот-лоу 94), затем цена ходит между ними,
  // касаясь каждой границы минимум дважды и ни разу не закрываясь за ней —
  // ровно то, что конспект называет "проторговкою діапазоном".
  function rangeCandles(): DailyCandle[] {
    const rows: [number, number, number, number][] = [
      [100, 102, 98, 101],
      [101, 104, 100, 103],
      [103, 106, 102, 105],
      [105, 110, 104, 109], // 3 — пивот-хай (слом), h=110
      [108, 109, 105, 106],
      [106, 107, 102, 103],
      [103, 104, 99, 100],
      [100, 101, 94, 95], // 7 — пивот-лоу (откат), l=94
      [100, 109.5, 104.5, 105], // касание верха
      [104, 105, 99, 100],
      [100, 99.5, 94.5, 99], // касание низа
      [99, 104, 98, 103],
      [103, 109.5, 104.5, 105], // касание верха (2-е)
      [104, 105, 99, 100],
      [100, 99.5, 94.5, 99], // касание низа (2-е)
      [99, 104, 98, 103],
      [103, 105, 100, 104],
      [104, 106, 101, 105],
      [105, 107, 102, 106],
      [106, 108, 103, 107],
    ];
    return rows.map(([o, h, l, c], i) => candle(i, o, h, l, c));
  }

  it("finds upper/lower bounds of a range confirmed by 2 touches per border", () => {
    const levels = detectLevels(rangeCandles());
    const borders = levels.filter((l) => l.type === "range_border");
    expect(borders.length).toBe(2);
    expect(borders.some((l) => Math.abs(l.price - 110) < 0.5)).toBe(true);
    expect(borders.some((l) => Math.abs(l.price - 94) < 0.5)).toBe(true);
    for (const b of borders) expect(b.touches.length).toBeGreaterThanOrEqual(2);
  });

  it("does not confirm a range when a border gets only 1 touch", () => {
    const candles = rangeCandles();
    // Убираем оба вторых касания (индексы 12 и 14), заменяя их нейтральными
    // барами — по одному касанию на границу уже недостаточно для range.
    candles[12] = candle(12, 103, 105, 100, 104);
    candles[14] = candle(14, 100, 104, 98, 103);
    const levels = detectLevels(candles);
    const borders = levels.filter((l) => l.type === "range_border");
    expect(borders.length).toBe(0);
  });
});

describe("detectLevels — local_stop", () => {
  // Реальные дневные свечи SYNUSDT (22.07–14.08.2026, живая БД): резкий обвал
  // после пампа, затем цена находит опору на 07.08 (лоу 0.0983) и держится
  // над ней до конца окна — тот самый кейс со скриншота пользователя, где
  // обычный fractal-пивот молчит, потому что 04.08 (лоу 0.0834) левее ниже.
  function synCandles(): DailyCandle[] {
    const rows: [number, number, number, number][] = [
      [0.203, 0.2072, 0.1801, 0.1813],
      [0.1814, 0.1869, 0.1281, 0.1436],
      [0.1437, 0.1559, 0.1398, 0.1437],
      [0.1437, 0.1898, 0.1422, 0.1713],
      [0.1712, 0.1789, 0.1425, 0.1437],
      [0.1437, 0.1488, 0.1375, 0.1418],
      [0.1418, 0.1517, 0.1335, 0.1354],
      [0.1353, 0.1382, 0.1262, 0.132],
      [0.132, 0.1328, 0.1053, 0.106],
      [0.106, 0.1131, 0.0978, 0.1013],
      [0.1013, 0.113, 0.0856, 0.0871],
      [0.0872, 0.0963, 0.0858, 0.0888],
      [0.0888, 0.0899, 0.0805, 0.0853], // 12 — дно обвала, лоу=0.0805
      [0.0852, 0.1037, 0.0834, 0.0943],
      [0.0943, 0.1479, 0.0938, 0.1421],
      [0.142, 0.1444, 0.1168, 0.1179],
      [0.1178, 0.1237, 0.0983, 0.107], // 16 — опорная точка, лоу=0.0983
      [0.1071, 0.1277, 0.1002, 0.1068],
      [0.1067, 0.111, 0.1024, 0.1061],
      [0.1061, 0.1093, 0.0996, 0.1011],
      [0.1011, 0.1108, 0.0992, 0.1083],
      [0.1083, 0.1099, 0.1004, 0.1025],
      [0.1026, 0.1099, 0.1011, 0.1092],
      [0.1091, 0.1166, 0.1068, 0.1139],
    ];
    return rows.map(([o, h, l, c], i) => candle(i, o, h, l, c));
  }

  it("finds the recent pause low as a local_stop even though a deeper low sits just to its left", () => {
    const levels = detectLevels(synCandles());
    const localStop = levels.find((l) => l.type === "local_stop" && Math.abs(l.price - 0.0983) < 0.0005);
    expect(localStop).toBeDefined();
    // Тот же самый бар как fractal-пивот НЕ находится — дно обвала (0.0805
    // на баре 12) левее делает его не экстремумом окна.
    const breakPoint = levels.find((l) => l.type === "break_point" && Math.abs(l.price - 0.0983) < 0.0005);
    expect(breakPoint).toBeUndefined();
  });

  it("does not confirm a local_stop when a later bar closes deep beyond the anchor", () => {
    const rows = synCandles();
    // Глубокий пробой опоры вскоре после неё — сетап должен отмениться.
    rows[18] = candle(18, 0.1067, 0.108, 0.06, 0.065);
    const levels = detectLevels(rows);
    const localStop = levels.find((l) => l.type === "local_stop" && Math.abs(l.price - 0.0983) < 0.0005);
    expect(localStop).toBeUndefined();
  });

  it("does not confirm a local_stop when a confirm bar's WICK pierces deep, even if its close recovers back near the level (HK0700USDT-like)", () => {
    const rows = synCandles();
    // Хвост бара 17 проваливается на несколько ATR ниже опоры (0.0983), но
    // закрывается почти вплотную к уровню — раньше это засчитывалось всего
    // как "один неглубокий ЛП", хотя реального удержания опоры не было.
    rows[17] = candle(17, 0.1071, 0.1277, 0.05, 0.098);
    const levels = detectLevels(rows);
    const localStop = levels.find((l) => l.type === "local_stop" && Math.abs(l.price - 0.0983) < 0.0005);
    expect(localStop).toBeUndefined();
  });

  it("requires the immediately preceding bar to have made a deeper extreme (a genuine pause, not mid-trend noise)", () => {
    // Ровный подъём без остановок — ни один бар не должен стать местной опорой.
    const rows: DailyCandle[] = Array.from({ length: 22 }, (_, i) =>
      candle(i, 100 + i, 102 + i, 99 + i, 101 + i),
    );
    const levels = detectLevels(rows);
    expect(levels.filter((l) => l.type === "local_stop")).toHaveLength(0);
  });
});

describe("mergeLevels", () => {
  it("merges levels within tolerance into one with combined strength", () => {
    const a: DetectedLevel = { price: 100, type: "break_point", strength: 1, touches: [{ barIndex: 0, t: 0, side: "resistance" }], formedAt: 0, lastTouchedAt: 0 };
    const b: DetectedLevel = { price: 100.5, type: "break_point", strength: 2, touches: [{ barIndex: 1, t: 1, side: "support" }], formedAt: 1, lastTouchedAt: 1 };
    const merged = mergeLevels([a, b], 10, 0.15); // tolerance = 1.5, diff = 0.5 -> merges
    expect(merged.length).toBe(1);
    expect(merged[0].strength).toBe(3);
    expect(merged[0].touches.length).toBe(2);
  });

  it("keeps far-apart levels separate", () => {
    const a: DetectedLevel = { price: 100, type: "break_point", strength: 1, touches: [], formedAt: 0, lastTouchedAt: 0 };
    const b: DetectedLevel = { price: 200, type: "break_point", strength: 1, touches: [], formedAt: 0, lastTouchedAt: 0 };
    const merged = mergeLevels([a, b], 10, 0.15);
    expect(merged.length).toBe(2);
  });
});

describe("filterLevelsNearPrice", () => {
  it("keeps only levels within maxDistanceAtr, sorted by distance", () => {
    const levels: DetectedLevel[] = [
      { price: 100, type: "break_point", strength: 1, touches: [], formedAt: 0, lastTouchedAt: 0 },
      { price: 110, type: "break_point", strength: 1, touches: [], formedAt: 0, lastTouchedAt: 0 },
      { price: 200, type: "break_point", strength: 1, touches: [], formedAt: 0, lastTouchedAt: 0 },
    ];
    const atr = 10;
    const currentPrice = 105;
    const near = filterLevelsNearPrice(levels, currentPrice, atr, 1.5); // <=15 away
    expect(near.map((l) => l.price)).toEqual([100, 110]);
  });

  // Близость — это докуда бар ДОТЯНУЛСЯ, а не где закрылся: длинная свеча
  // иначе уводит уровень «далеко» ровно на свою длину (WENUSDT, хай параБАРа
  // в 1.97×ATR от закрытия при 1.27×ATR от хая того же бара).
  it("measures the distance from the last bar's high/low, not from its close", () => {
    const levels: DetectedLevel[] = [
      { price: 120, type: "parabar", strength: 5, touches: [], formedAt: 0, lastTouchedAt: 0 },
      { price: 80, type: "break_point", strength: 1, touches: [], formedAt: 0, lastTouchedAt: 0 },
    ];
    const atr = 10;
    const last = candle(0, 100, 112, 88, 100); // закрылись на 100, дотянулись до 112 и 88
    // От закрытия оба уровня в 2×ATR — вне окна.
    expect(filterLevelsNearPrice(levels, 100, atr, 1.5)).toHaveLength(0);
    // От границ бара — 0.8×ATR, оба в окне.
    expect(filterLevelsNearPrice(levels, 100, atr, 1.5, last).map((l) => l.price)).toEqual([120, 80]);
  });

  it("treats a level the last bar already pierced as touching distance", () => {
    const levels: DetectedLevel[] = [
      { price: 105, type: "parabar", strength: 5, touches: [], formedAt: 0, lastTouchedAt: 0 },
    ];
    const last = candle(0, 100, 130, 95, 100); // хай ушёл далеко ЗА уровень
    expect(filterLevelsNearPrice(levels, 100, 10, 1.5, last)).toHaveLength(1);
  });
});

// Плавный линейный снос цены от startPrice к endPrice за `count` баров, с
// небольшим шумом внутри бара (±noise на закрытии) — не идеальный зигзаг, а
// то, как реально выглядит цена на графике: колеблется, но в среднем едет
// в одну сторону.
function driftSeries(count: number, startPrice: number, endPrice: number, noise = 1): DailyCandle[] {
  return Array.from({ length: count }, (_, i) => {
    const base = startPrice + ((endPrice - startPrice) * i) / (count - 1);
    const wiggle = i % 2 === 0 ? noise : -noise;
    return candle(i, base, base + noise + 1, base - noise - 1, base + wiggle);
  });
}

describe("detectTrend", () => {
  it("recognizes a downtrend from the average price of the window's two halves", () => {
    expect(detectTrend(driftSeries(60, 200, 140))).toBe("down");
  });

  it("recognizes an uptrend from the average price of the window's two halves", () => {
    expect(detectTrend(driftSeries(60, 140, 200))).toBe("up");
  });

  it("calls a flat/choppy series range", () => {
    expect(detectTrend(flatSeries(60, 100, 2))).toBe("range");
  });

  it("calls a series with big moves but no net drift range (up then back down within the same window)", () => {
    // Первая половина окна едет вверх, вторая — обратно вниз до того же
    // уровня: средняя цена половин почти совпадает, несмотря на заметные
    // внутренние движения — реальный "боковик с размахом", а не тренд.
    const up = driftSeries(30, 150, 200);
    const down = driftSeries(30, 200, 150).map((c, i) => candle(30 + i, c.o, c.h, c.l, c.c));
    expect(detectTrend([...up, ...down])).toBe("range");
  });

  it("requires at least `window` bars of history", () => {
    expect(detectTrend(driftSeries(10, 200, 140))).toBe("range");
  });
});

// Окно свежести: уровень образца прошлого года формально набирает касания и
// силу, но торгуем мы то, что рынок помнит — БСУ должен лежать в последних
// FRESH_LEVEL_BARS барах (по умолчанию полгода).
describe("detectLevels — окно свежести БСУ", () => {
  // Старый пивот на 200 (бар 15), затем длинный ровный участок и свежий
  // пивот на 130 в самом конце ряда.
  function agedSeries(tailLength: number): DailyCandle[] {
    const rows: DailyCandle[] = [];
    for (let i = 0; i < 15; i++) rows.push(candle(i, 100 + i, 101 + i, 99 + i, 100 + i));
    rows.push(candle(15, 115, 200, 114, 116)); // старый пивот-хай 200
    for (let i = 16; i < 16 + tailLength; i++) rows.push(candle(i, 100, 102, 98, 100));
    const n = rows.length;
    rows.push(candle(n, 100, 130, 99, 101)); // свежий пивот-хай 130
    for (let i = 1; i <= 6; i++) rows.push(candle(n + i, 100, 102, 98, 100));
    return rows;
  }

  it("drops levels whose BSU is older than the freshness window", () => {
    const candles = agedSeries(200);
    const levels = detectLevels(candles);
    expect(levels.find((l) => Math.abs(l.price - 200) < 0.01)).toBeUndefined();
    expect(levels.find((l) => Math.abs(l.price - 130) < 0.01)).toBeDefined();
  });

  it("keeps the same old level while it still fits into the window", () => {
    const levels = detectLevels(agedSeries(100));
    expect(levels.find((l) => Math.abs(l.price - 200) < 0.01)).toBeDefined();
  });

  it("does not let an out-of-window pivot lend its age and strength to a fresh level nearby", () => {
    // Старый и свежий пивоты на почти одной цене: без фильтра ДО merge они
    // схлопнулись бы в один уровень с БСУ годичной давности.
    const rows: DailyCandle[] = [];
    for (let i = 0; i < 15; i++) rows.push(candle(i, 100 + i, 101 + i, 99 + i, 100 + i));
    rows.push(candle(15, 115, 130.2, 114, 116)); // старый пивот 130.2
    for (let i = 16; i < 216; i++) rows.push(candle(i, 100, 102, 98, 100));
    rows.push(candle(216, 100, 130, 99, 101)); // свежий пивот 130
    for (let i = 217; i <= 222; i++) rows.push(candle(i, 100, 102, 98, 100));

    const level = detectLevels(rows).find((l) => Math.abs(l.price - 130) < 0.5);
    expect(level).toBeDefined();
    expect(level!.formedAt).toBe(rows[216].t);
  });

  it("freshnessBars: 0 turns the window off", () => {
    const levels = detectLevels(agedSeries(200), { freshnessBars: 0 });
    expect(levels.find((l) => Math.abs(l.price - 200) < 0.01)).toBeDefined();
  });
});
