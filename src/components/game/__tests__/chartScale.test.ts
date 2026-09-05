import { describe, it, expect } from "vitest";
import { slotOf, timeOfSlot, TF_MS } from "@/components/game/PriceChart";

const HOUR = 3_600_000;

/**
 * Ряд с расписанием: семь часов сессии в день, между днями — восемнадцать
 * часов пустоты. Именно на таком ряду дважды ломалась ось.
 */
function sessionSeries(days = 4) {
  const bars: { t: number; o: number; h: number; l: number; c: number; v: number }[] = [];
  // Первый бар — ПОСЛЕДНИЙ час сессии: так и начинается история у половины
  // инструментов, и именно из-за этого «шаг по первым двум свечам» давал 18
  // часов вместо часа.
  const start = Date.UTC(2026, 8, 1, 20, 0, 0);
  bars.push({ t: start, o: 1, h: 1, l: 1, c: 1, v: 1 });
  for (let d = 1; d <= days; d++) {
    for (let h = 14; h <= 20; h++) {
      bars.push({ t: Date.UTC(2026, 8, 1 + d, h, 0, 0), o: 1, h: 1, l: 1, c: 1, v: 1 });
    }
  }
  return bars;
}

describe("шкала графика: номер свечи вместо календарного времени", () => {
  const bars = sessionSeries();

  it("каждая свеча стоит на своём номере, соседние — на соседних", () => {
    for (let i = 0; i < bars.length; i++) {
      expect(slotOf(bars, HOUR, bars[i].t)).toBeCloseTo(i, 9);
    }
  });

  it("центр свечи — ровно посередине её слота, а не через шесть баров", () => {
    // Та самая ошибка: шаг брался из первых двух свечей (18 часов), центр
    // t + шаг/2 уезжал на следующий день, и все свечи сессии ложились в одну
    // точку.
    for (let i = 0; i < bars.length; i++) {
      expect(slotOf(bars, HOUR, bars[i].t + HOUR / 2)).toBeCloseTo(i + 0.5, 9);
    }
  });

  it("перерыв между сессиями на оси места не занимает", () => {
    const lastOfDay = bars.findIndex((b) => new Date(b.t).getUTCHours() === 20 && b.t > bars[0].t);
    const firstOfNext = lastOfDay + 1;
    // Восемнадцать часов реального времени — один шаг по оси.
    expect(slotOf(bars, HOUR, bars[firstOfNext].t) - slotOf(bars, HOUR, bars[lastOfDay].t)).toBeCloseTo(1, 9);
    // Момент внутри перерыва не выходит за стык двух свечей.
    const inGap = bars[lastOfDay].t + 9 * HOUR;
    const slot = slotOf(bars, HOUR, inGap);
    expect(slot).toBeGreaterThanOrEqual(lastOfDay);
    expect(slot).toBeLessThanOrEqual(lastOfDay + 1);
  });

  it("шкала монотонна — подписи оси не могут пойти назад во времени", () => {
    let previous = -Infinity;
    for (let slot = -20; slot <= bars.length + 20; slot += 0.25) {
      const ms = timeOfSlot(bars, HOUR, slot);
      expect(ms).toBeGreaterThanOrEqual(previous);
      previous = ms;
    }
  });

  it("прямое и обратное преобразование сходятся на самих свечах", () => {
    for (let i = 0; i < bars.length; i++) {
      expect(timeOfSlot(bars, HOUR, i)).toBe(bars[i].t);
    }
  });

  it("за краями ряда шкала продолжается ровным шагом", () => {
    expect(timeOfSlot(bars, HOUR, -3)).toBe(bars[0].t - 3 * HOUR);
    const last = bars.length - 1;
    expect(timeOfSlot(bars, HOUR, last + 4)).toBe(bars[last].t + 4 * HOUR);
  });

  it("пустой ряд не роняет шкалу", () => {
    expect(slotOf([], HOUR, Date.now())).toBe(0);
    expect(timeOfSlot([], HOUR, 5)).toBe(5 * HOUR);
  });

  it("у каждого таймфрейма есть свой шаг — из него и считается центр свечи", () => {
    for (const code of ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"]) {
      expect(TF_MS[code]).toBeGreaterThan(0);
    }
  });
});

describe("шкала на дневном ряду с выходными", () => {
  // Пятница, понедельник, вторник: между первыми двумя — трое суток.
  const daily = [
    { t: Date.UTC(2026, 8, 4), o: 1, h: 1, l: 1, c: 1, v: 1 },
    { t: Date.UTC(2026, 8, 7), o: 1, h: 1, l: 1, c: 1, v: 1 },
    { t: Date.UTC(2026, 8, 8), o: 1, h: 1, l: 1, c: 1, v: 1 },
  ];
  const DAY = 24 * HOUR;

  it("выходные не растягивают ось", () => {
    expect(slotOf(daily, DAY, daily[1].t)).toBeCloseTo(1, 9);
    expect(slotOf(daily, DAY, daily[2].t)).toBeCloseTo(2, 9);
  });

  it("центр пятничной свечи не перескакивает на понедельник", () => {
    expect(slotOf(daily, DAY, daily[0].t + DAY / 2)).toBeCloseTo(0.5, 9);
  });
});
