import { describe, it, expect } from "vitest";
import { detectFalseBreakout2b, DEFAULT_2B_THRESHOLDS } from "../falseBreakout2b";
import type { DailyCandle } from "../levels";

const DAY = 86_400_000;
const START = Date.UTC(2026, 6, 1);

function bar(i: number, o: number, h: number, l: number, c: number): DailyCandle {
  return { t: START + i * DAY, o, h, l, c };
}

const LEVEL = 100;
const ATR = 10;

/**
 * Заготовка ЛП2Б: 20 спокойных дней далеко под уровнем, затем быстрый подход
 * большими барами и пробойный бар, который закрылся чуть выше уровня.
 */
function series(overrides: { close?: number; high?: number; approachFlat?: boolean } = {}): DailyCandle[] {
  const candles: DailyCandle[] = [];
  for (let i = 0; i < 20; i++) candles.push(bar(i, 60, 62, 58, 60));
  if (overrides.approachFlat) {
    // Медленный подход мелкими барами — «быстрого подхода» нет.
    candles.push(bar(20, 61, 63, 60, 62));
    candles.push(bar(21, 62, 64, 61, 63));
    candles.push(bar(22, 63, 65, 62, 64));
  } else {
    candles.push(bar(20, 62, 75, 61, 74));
    candles.push(bar(21, 74, 84, 73, 82));
    candles.push(bar(22, 82, 90, 81, 89));
  }
  candles.push(bar(23, 96, overrides.high ?? 106, 95, overrides.close ?? 101));
  return candles;
}

describe("detectFalseBreakout2b", () => {
  it("detects the setup: broke the level and closed just beyond it", () => {
    const res = detectFalseBreakout2b(series(), LEVEL, ATR)!;
    expect(res).not.toBeNull();
    expect(res.brokeSide).toBe("up");
    // Пробили вверх — завтра работаем на возврат, то есть вниз.
    expect(res.direction).toBe("short");
    expect(res.closeBeyondAtr).toBeCloseTo(0.1, 5);
    expect(res.pierceAtr).toBeCloseTo(0.6, 5);
    // Ради чего сетап и нужен: завтрашнему бару хватит доли ATR.
    expect(res.returnMoveAtr).toBeCloseTo(0.18, 5);
  });

  it("works symmetrically for a level broken downwards", () => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < 20; i++) candles.push(bar(i, 140, 142, 138, 140));
    candles.push(bar(20, 139, 140, 126, 127));
    candles.push(bar(21, 127, 128, 113, 114));
    candles.push(bar(22, 114, 115, 104, 105));
    candles.push(bar(23, 105, 106, 94, 99));
    const res = detectFalseBreakout2b(candles, LEVEL, ATR)!;
    expect(res.brokeSide).toBe("down");
    expect(res.direction).toBe("long");
    expect(res.closeBeyondAtr).toBeCloseTo(0.1, 5);
  });

  it("rejects a close far beyond the level — that is a real breakout", () => {
    // Закрытие на 0.9 ATR за уровнем при пороге 0.5.
    expect(detectFalseBreakout2b(series({ close: 109, high: 110 }), LEVEL, ATR)).toBeNull();
  });

  it("rejects when the level was only touched, not pierced", () => {
    // Хай едва выше уровня — 0.03 ATR при пороге 0.08.
    expect(detectFalseBreakout2b(series({ close: 100.2, high: 100.3 }), LEVEL, ATR)).toBeNull();
  });

  // Пологое многодневное «подползание» к уровню мелкими барами — не тот
  // разгон, после которого ждут возврата: пробой такого подхода чаще честный.
  it("rejects a slow approach without big bars", () => {
    const slow: DailyCandle[] = [];
    for (let i = 0; i < 20; i++) slow.push(bar(i, 90, 91, 89, 90));
    slow.push(bar(20, 90, 92.5, 89.5, 92));
    slow.push(bar(21, 92, 94.5, 91.5, 94));
    slow.push(bar(22, 94, 99.4, 93.5, 99));
    slow.push(bar(23, 99, 101.2, 98.8, 100.6));
    expect(detectFalseBreakout2b(slow, LEVEL, ATR)).toBeNull();
  });

  // Накопление ПОД уровнем — подготовка честного пробоя, а не возврата.
  it("rejects accumulation squeezed under the level", () => {
    const squeeze: DailyCandle[] = [];
    for (let i = 0; i < 20; i++) squeeze.push(bar(i, 60, 62, 58, 60));
    // Пять баров в узком коридоре вплотную под уровнем 100.
    for (let i = 20; i < 25; i++) squeeze.push(bar(i, 98, 99.5, 97.5, 98.5));
    squeeze.push(bar(25, 98.5, 106, 98, 101));
    expect(detectFalseBreakout2b(squeeze, LEVEL, ATR)).toBeNull();
  });

  // Тот же подход, но одним крупным баром — это уже разгон, сетап валиден.
  it("accepts a fast approach made by one large bar", () => {
    const fast: DailyCandle[] = [];
    for (let i = 0; i < 20; i++) fast.push(bar(i, 80, 81, 79, 80));
    fast.push(bar(20, 80, 81, 79, 80));
    fast.push(bar(21, 80, 81, 79, 80));
    fast.push(bar(22, 80, 81, 79, 80));
    fast.push(bar(23, 80, 106, 79.5, 101));
    expect(detectFalseBreakout2b(fast, LEVEL, ATR)).not.toBeNull();
  });

  it("rejects a recent retest — the level must have stood untouched", () => {
    const candles = series();
    // Полноценный ретест за 8 дней до пробоя: бар достал до уровня и
    // закрылся рядом с ним — ближе порога в 20 дней.
    candles[15] = bar(15, 95, 100.5, 94, 98);
    expect(detectFalseBreakout2b(candles, LEVEL, ATR)).toBeNull();
  });

  // Бар разгона пролетает мимо уровня и закрывается далеко — это не ретест,
  // иначе условие дальнего ретеста не выполнялось бы никогда.
  it("does not count a fast approach bar as a retest", () => {
    const candles = series();
    // Бар дотянулся до уровня тенью, но закрылся в 1.5 ATR от него.
    candles[22] = bar(22, 82, 100.5, 81, 85);
    expect(detectFalseBreakout2b(candles, LEVEL, ATR)).not.toBeNull();
  });

  // А вот бар, который достал до уровня И ЗАКРЫЛСЯ рядом, — полноценный
  // ретест: цена у уровня задержалась.
  it("counts a bar that reached the level and closed near it as a retest", () => {
    const candles = series();
    candles[22] = bar(22, 82, 100.5, 81, 97);
    expect(detectFalseBreakout2b(candles, LEVEL, ATR)).toBeNull();
  });

  // «Накопление со стороны пробоя»: цена несколько дней жмётся к уровню — это
  // подготовка честного пробоя (живой случай DEEPUSDT 18.08.2026).
  it("rejects when price hugged the level for days before the break", () => {
    const candles = series();
    for (let i = 18; i <= 22; i++) candles[i] = bar(i, 95, 99, 93, 96);
    expect(detectFalseBreakout2b(candles, LEVEL, ATR)).toBeNull();
  });

  it("rejects when the price was already beyond the level the day before", () => {
    const candles = series();
    // Предыдущий бар тоже закрылся выше уровня — пробой не свежий.
    candles[candles.length - 2] = bar(22, 87, 104, 86, 102);
    expect(detectFalseBreakout2b(candles, LEVEL, ATR)).toBeNull();
  });

  it("returns null without a usable ATR or with too little history", () => {
    expect(detectFalseBreakout2b(series(), LEVEL, 0)).toBeNull();
    expect(detectFalseBreakout2b(series().slice(-3), LEVEL, ATR)).toBeNull();
  });

  it("reports an untouched level as an infinitely far retest", () => {
    const res = detectFalseBreakout2b(series(), LEVEL, ATR)!;
    expect(res.daysSinceTouch).toBe(Infinity);
    expect(res.daysSinceTouch).toBeGreaterThan(DEFAULT_2B_THRESHOLDS.minDaysSinceTouch);
  });
});
