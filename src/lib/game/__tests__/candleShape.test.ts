import { describe, it, expect } from "vitest";
import {
  ANCHORS_PER_HOUR,
  barVolume,
  bridgePath,
  freshVolState,
  intradayFactor,
  MAX_VOL_MULTIPLIER,
  nextVolState,
  shapeBar,
} from "@/lib/game/candleShape";
import { normal, nextCandle, regimeTimeline, MS_HOUR, MS_PER_YEAR } from "@/lib/game/marketGen";
import type { Asset } from "@/engine/entities/types";

const HOURLY_SIGMA = 0.32 * Math.sqrt(MS_HOUR / MS_PER_YEAR);

const asset = {
  id: "STK_A",
  symbol: "A",
  name: "A",
  assetClass: "stock",
  sector: "tech",
  correlationGroup: "tech",
  baseVolatility: 0.32,
  baseDrift: 0,
  tickSize: 0.01,
  startPrice: 100,
} as unknown as Asset;

describe("кластеризация волатильности", () => {
  it("большой ход поднимает волатильность следующего бара", () => {
    // Это главное свойство настоящих рядов: после сильного движения ещё
    // несколько часов трясёт. Из него и берутся «поджатия» и «выносы».
    const calm = nextVolState(freshVolState(HOURLY_SIGMA), 0, HOURLY_SIGMA, false);
    const shocked = nextVolState(freshVolState(HOURLY_SIGMA), HOURLY_SIGMA * 5, HOURLY_SIGMA, false);
    expect(shocked.variance).toBeGreaterThan(calm.variance);
  });

  it("после всплеска волатильность возвращается к своей средней", () => {
    // Кормим ТИПИЧНЫМИ доходностями (порядка σ), а не нулями: ряд из одних
    // нулей рынку не соответствует и утянул бы дисперсию к нижнему пределу
    // модели, а не к её долгосрочной средней.
    let state = nextVolState(freshVolState(HOURLY_SIGMA), HOURLY_SIGMA * 6, HOURLY_SIGMA, false);
    const peak = state.variance;
    for (let i = 0; i < 400; i++) {
      // Знак не важен, в дисперсию входит квадрат.
      state = nextVolState(state, HOURLY_SIGMA * (i % 2 === 0 ? 1 : -1), HOURLY_SIGMA, false);
    }
    expect(state.variance).toBeLessThan(peak);
    expect(state.variance).toBeGreaterThan(HOURLY_SIGMA * HOURLY_SIGMA * 0.7);
    expect(state.variance).toBeLessThan(HOURLY_SIGMA * HOURLY_SIGMA * 1.4);
  });

  it("выброс не раскручивает дисперсию в бесконечность", () => {
    // Без потолка редкий хвост распределения уводил цену на сотни процентов
    // в год — это было измерено на прогоне в 3000 баров.
    let state = freshVolState(HOURLY_SIGMA);
    for (let i = 0; i < 500; i++) state = nextVolState(state, HOURLY_SIGMA * 20, HOURLY_SIGMA, true);
    expect(Math.sqrt(state.variance)).toBeLessThanOrEqual(HOURLY_SIGMA * MAX_VOL_MULTIPLIER + 1e-12);
  });

  it("новость раздувает волатильность и та затухает за несколько часов", () => {
    const hit = nextVolState(freshVolState(HOURLY_SIGMA), 0, HOURLY_SIGMA, true);
    expect(hit.newsBoost).toBeGreaterThan(0);
    let state = hit;
    for (let i = 0; i < 12; i++) state = nextVolState(state, 0, HOURLY_SIGMA, false);
    expect(state.newsBoost).toBeLessThan(hit.newsBoost * 0.1);
  });
});

describe("внутридневная сезонность", () => {
  it("у биржи открытие и закрытие активнее середины сессии", () => {
    const open = intradayFactor("stock", 14);
    const midday = intradayFactor("stock", 17);
    const close = intradayFactor("stock", 20);
    expect(open).toBeGreaterThan(midday);
    expect(close).toBeGreaterThan(midday);
  });

  it("у валют пик на пересечении Лондона и Нью-Йорка, азиатская ночь тиха", () => {
    expect(intradayFactor("forex", 14)).toBeGreaterThan(intradayFactor("forex", 2));
  });

  it("крипта ровнее остальных: рынок работает всегда", () => {
    const cryptoSpread = intradayFactor("crypto", 14) / intradayFactor("crypto", 2);
    const forexSpread = intradayFactor("forex", 14) / intradayFactor("forex", 2);
    expect(cryptoSpread).toBeLessThan(forexSpread);
  });
});

describe("мост внутри бара", () => {
  const path = (n: number, key = "k") => bridgePath((i) => normal(`${key}|${i}`), n);

  it("начинается и заканчивается нулём — концы бара уже известны", () => {
    const p = path(12);
    expect(p[0]).toBe(0);
    expect(p[p.length - 1]).toBeCloseTo(0, 12);
  });

  it("нормирован по времени: разброс середины — половина σ, как у броуновского пути", () => {
    // Без нормировки разброс внутри бара зависел бы от числа опорных точек, а
    // не от волатильности, и часовой бар выходил в 8% вместо 0.5%. Проверяем
    // РАЗБРОС, а не максимум: у нормального распределения отдельные выбросы
    // за три сигмы — норма, и цепляться к ним бессмысленно.
    const mid = ANCHORS_PER_HOUR / 2;
    const values = Array.from({ length: 4000 }, (_, k) => path(ANCHORS_PER_HOUR, `n${k}`)[mid]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    // Теория для моста: sd в середине равна √(t(1−t)) = 0.5.
    expect(sd).toBeGreaterThan(0.4);
    expect(sd).toBeLessThan(0.6);
  });
});

describe("форма бара снимается с пути", () => {
  it("тени не могут оказаться внутри тела", () => {
    for (let i = 0; i < 200; i++) {
      const bar = shapeBar(100, 100 + (i % 7) - 3, 0.004, bridgePath((k) => normal(`s${i}|${k}`), 12));
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close) - 1e-9);
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close) + 1e-9);
    }
  });

  it("формы разные: есть и бары без теней, и дожи", () => {
    // Прежний генератор дорисовывал тени формулой, и у КАЖДОЙ свечи была и
    // верхняя, и нижняя. Именно из-за этого «все свечи одинаковые».
    const regimes = regimeTimeline("shape", 400);
    let price = 100;
    let vol = freshVolState(HOURLY_SIGMA);
    let noUpper = 0;
    let doji = 0;
    const total = 1500;
    for (let i = 0; i < total; i++) {
      const step = nextCandle(price, {
        seed: "shape",
        asset,
        kind: "h",
        stepMs: MS_HOUR,
        regimes,
        ts: Date.UTC(2026, 0, 5, 14) + i * MS_HOUR,
        index: i,
        news: [],
        vol,
      });
      vol = step.vol;
      price = step.candle.close;
      const c = step.candle;
      const range = c.high - c.low;
      if (range > 0 && c.high - Math.max(c.open, c.close) < range * 0.02) noUpper++;
      if (range > 0 && Math.abs(c.close - c.open) < range * 0.1) doji++;
    }
    expect(noUpper / total).toBeGreaterThan(0.05);
    expect(doji / total).toBeGreaterThan(0.02);
  });

  it("размер бара не постоянен — разброс сопоставим со средним", () => {
    const regimes = regimeTimeline("size", 400);
    let price = 100;
    let vol = freshVolState(HOURLY_SIGMA);
    const ranges: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const step = nextCandle(price, {
        seed: "size",
        asset,
        kind: "h",
        stepMs: MS_HOUR,
        regimes,
        ts: Date.UTC(2026, 0, 5, 14) + i * MS_HOUR,
        index: i,
        news: [],
        vol,
      });
      vol = step.vol;
      price = step.candle.close;
      ranges.push((step.candle.high - step.candle.low) / step.candle.open);
    }
    const mean = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const sd = Math.sqrt(ranges.reduce((a, b) => a + (b - mean) ** 2, 0) / ranges.length);
    // Часовой размах у акции с годовой волатильностью 32% — доли процента.
    expect(mean).toBeGreaterThan(0.001);
    expect(mean).toBeLessThan(0.02);
    // И он ЗАМЕТНО плавает: одинаковые свечи — это как раз то, на что жаловались.
    expect(sd / mean).toBeGreaterThan(0.25);
  });
});

describe("объём", () => {
  it("считается по пройденному пути, а не по телу", () => {
    // Час, где цена сходила вверх и вернулась, торговался активно, хотя тело
    // у него нулевое.
    const flat = barVolume(asset, [100, 100, 100, 100], 0, 1, 0.5);
    const travelled = barVolume(asset, [100, 102, 98, 100], 0, 1, 0.5);
    expect(travelled).toBeGreaterThan(flat);
  });

  it("новость поднимает объём", () => {
    const quiet = barVolume(asset, [100, 101, 100], 0, 1, 0.5);
    const loud = barVolume(asset, [100, 101, 100], 2, 1, 0.5);
    expect(loud).toBeGreaterThan(quiet);
  });
});
