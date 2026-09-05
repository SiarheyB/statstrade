import { describe, it, expect } from "vitest";
import {
  aggregate,
  bridgeMinutes,
  hash32,
  historyMonths,
  MAX_HISTORY_MONTHS,
  MIN_HISTORY_MONTHS,
  MS_HOUR,
  MS_MINUTE,
  newsForHour,
  newsHits,
  nextCandle,
  normal,
  rand,
  regimeTimeline,
  shockFactor,
  type GeneratedCandle,
  type GeneratedNews,
} from "@/lib/game/marketGen";
import type { Asset } from "@/engine/entities/types";

const asset: Asset = {
  id: "STK_TEST",
  symbol: "TEST",
  name: "Test Co",
  assetClass: "stock",
  sector: "tech",
  correlationGroup: "tech_stocks",
  baseVolatility: 0.3,
  baseDrift: 0.06,
  tickSize: 0.01,
  tradingHours: "session",
};

const SEED = "world-seed";
const regimes = regimeTimeline(SEED, 60);

function ctx(index: number, news: GeneratedNews[] = []) {
  return { seed: SEED, asset, kind: "h" as const, stepMs: MS_HOUR, regimes, ts: index * MS_HOUR, index, news };
}

describe("детерминированность", () => {
  it("одинаковый ключ — одинаковое число, разный — разное", () => {
    expect(rand("a")).toBe(rand("a"));
    expect(rand("a")).not.toBe(rand("b"));
    expect(hash32("abc")).toBe(hash32("abc"));
  });

  it("случайные числа лежат в [0,1) и распределены не вырожденно", () => {
    const values = Array.from({ length: 500 }, (_, i) => rand(`k${i}`));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });

  it("нормальное распределение центрировано около нуля", () => {
    const values = Array.from({ length: 2000 }, (_, i) => normal(`n${i}`));
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(0.1);
  });

  // Главное свойство всей затеи: свечу можно пересчитать когда угодно и
  // получить ровно ту же — на этом держится «у всех игроков один рынок».
  it("бар пересчитывается один в один", () => {
    const a = nextCandle(100, ctx(42));
    const b = nextCandle(100, ctx(42));
    expect(a).toEqual(b);
  });

  it("соседние бары различаются — это не константа", () => {
    expect(nextCandle(100, ctx(1)).close).not.toBe(nextCandle(100, ctx(2)).close);
  });
});

describe("свечи", () => {
  it("high не ниже тела, low не выше — бар корректен", () => {
    for (let i = 0; i < 200; i++) {
      const candle = nextCandle(100, ctx(i));
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close) - 1e-9);
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close) + 1e-9);
      expect(candle.low).toBeGreaterThan(0);
      expect(candle.volume).toBeGreaterThan(0);
    }
  });

  it("цена округляется к шагу инструмента", () => {
    const forex: Asset = { ...asset, id: "FX", tickSize: 0.00001, baseVolatility: 0.08 };
    const candle = nextCandle(1.085, { ...ctx(5), asset: forex });
    expect(Math.round(candle.close / 0.00001) * 0.00001).toBeCloseTo(candle.close, 9);
  });

  it("новость по инструменту двигает его бар, чужая — нет", () => {
    const shock: GeneratedNews = { ts: 0, assetId: asset.id, sector: null, impact: "high", headline: "x", shockPct: -0.1 };
    const alien: GeneratedNews = { ...shock, assetId: "OTHER" };
    const plain = nextCandle(100, ctx(7)).close;
    const hit = nextCandle(100, ctx(7, [shock])).close;
    const miss = nextCandle(100, ctx(7, [alien])).close;
    expect(hit).toBeLessThan(plain * 0.95);
    expect(miss).toBe(plain);
  });

  it("глобальная новость задевает всех", () => {
    const global: GeneratedNews = { ts: 0, assetId: null, sector: null, impact: "high", headline: "x", shockPct: 0.1 };
    expect(newsHits(global, asset)).toBe(true);
    expect(newsHits({ ...global, sector: "energy" }, asset)).toBe(false);
    expect(newsHits({ ...global, sector: "tech" }, asset)).toBe(true);
  });

  it("плюс и минус одного размера компенсируют друг друга", () => {
    expect(shockFactor(0.1) * shockFactor(-0.1)).toBeCloseTo(1, 12);
  });
});

describe("режимы", () => {
  it("таймлайн детерминирован и покрывает все дни", () => {
    const a = regimeTimeline("s", 100);
    const b = regimeTimeline("s", 100);
    expect(a).toHaveLength(100);
    expect(a.map((d) => d.type)).toEqual(b.map((d) => d.type));
  });

  it("режим держится несколько дней подряд, а не скачет каждый день", () => {
    const timeline = regimeTimeline("s2", 200);
    let switches = 0;
    for (let i = 1; i < timeline.length; i++) if (timeline[i].type !== timeline[i - 1].type) switches++;
    expect(switches).toBeGreaterThan(0);
    expect(switches).toBeLessThan(60);
  });

  it("мир начинается с боковика — новичок не попадает сразу в кризис", () => {
    expect(regimeTimeline("s3", 10)[0].type).toBe("sideways");
  });
});

describe("новости", () => {
  it("выходят несколько раз в сутки, а не каждый час", () => {
    // История — полтора года часов: при новости каждый час накопленный шок
    // уводит цену в разы (проверено, золото уезжало с 2380 на 614).
    let count = 0;
    const days = 30;
    for (let h = 0; h < days * 24; h++) count += newsForHour(SEED, h, [asset], 1).length;
    const perDay = count / days;
    expect(perDay).toBeGreaterThan(1);
    expect(perDay).toBeLessThan(8);
  });

  it("макроновость двигает цену слабее, чем новость про сам инструмент", () => {
    const strong: GeneratedNews = { ts: 0, assetId: asset.id, sector: null, impact: "high", headline: "x", shockPct: -0.1 };
    const global: GeneratedNews = { ts: 0, assetId: null, sector: null, impact: "high", headline: "x", shockPct: -0.1 };
    const own = nextCandle(100, ctx(3, [strong])).close;
    const macro = nextCandle(100, ctx(3, [global])).close;
    expect(own).toBeLessThan(macro);
  });

  it("одна и та же новость для одного и того же часа", () => {
    const a = newsForHour(SEED, 11, [asset], 1);
    const b = newsForHour(SEED, 11, [asset], 1);
    expect(a).toEqual(b);
  });

  it("заголовок собран без плейсхолдеров", () => {
    for (let h = 0; h < 100; h++) {
      for (const news of newsForHour(SEED, h, [asset], 1)) {
        expect(news.headline).not.toContain("{");
        expect(Math.abs(news.shockPct)).toBeGreaterThan(0);
      }
    }
  });
});

describe("история и агрегация", () => {
  it("длина истории у инструмента в заданных границах и стабильна", () => {
    const months = historyMonths(SEED, asset.id);
    expect(months).toBeGreaterThanOrEqual(MIN_HISTORY_MONTHS);
    expect(months).toBeLessThanOrEqual(MAX_HISTORY_MONTHS);
    expect(historyMonths(SEED, asset.id)).toBe(months);
  });

  it("у разных инструментов история разной длины", () => {
    const lengths = new Set(["A", "B", "C", "D", "E", "F"].map((id) => historyMonths(SEED, id)));
    expect(lengths.size).toBeGreaterThan(1);
  });

  it("склейка минуток в часы: open первой, close последней, объём суммой", () => {
    const minutes: GeneratedCandle[] = Array.from({ length: 120 }, (_, i) => ({
      ts: i * MS_MINUTE,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 10,
    }));
    const hours = aggregate(minutes, MS_HOUR);
    expect(hours).toHaveLength(2);
    expect(hours[0].open).toBe(100);
    expect(hours[0].close).toBe(159.5);
    expect(hours[0].volume).toBe(600);
    expect(hours[1].ts).toBe(MS_HOUR);
  });

  it("пропуск в данных не склеивает соседние бакеты", () => {
    const sparse: GeneratedCandle[] = [
      { ts: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { ts: 5 * MS_HOUR, open: 2, high: 2, low: 2, close: 2, volume: 1 },
    ];
    expect(aggregate(sparse, MS_HOUR).map((c) => c.ts)).toEqual([0, 5 * MS_HOUR]);
  });
});

describe("минутки внутри часа (мост Броуна)", () => {
  const hour = nextCandle(100, ctx(12));

  it("первая минутка открывается ровно там же, где час, последняя им же закрывается", () => {
    const minutes = bridgeMinutes(hour, asset, SEED, 12);
    expect(minutes).toHaveLength(60);
    expect(minutes[0].open).toBeCloseTo(hour.open, 6);
    expect(minutes[59].close).toBeCloseTo(hour.close, 6);
  });

  it("минутки идут подряд без пропусков", () => {
    const minutes = bridgeMinutes(hour, asset, SEED, 12);
    for (let i = 1; i < minutes.length; i++) {
      expect(minutes[i].ts - minutes[i - 1].ts).toBe(MS_MINUTE);
    }
  });

  it("склейка минуток обратно в час даёт тот же open и close", () => {
    const minutes = bridgeMinutes(hour, asset, SEED, 12);
    const [rebuilt] = aggregate(minutes, MS_HOUR);
    expect(rebuilt.open).toBeCloseTo(hour.open, 6);
    expect(rebuilt.close).toBeCloseTo(hour.close, 6);
  });

  it("внутри часа цена не стоит на месте", () => {
    const minutes = bridgeMinutes(hour, asset, SEED, 12);
    const closes = new Set(minutes.map((m) => m.close));
    expect(closes.size).toBeGreaterThan(5);
  });

  it("минутки того же часа воспроизводятся один в один", () => {
    expect(bridgeMinutes(hour, asset, SEED, 12)).toEqual(bridgeMinutes(hour, asset, SEED, 12));
  });

  it("можно попросить только начало часа — для ещё не закрытого бара", () => {
    const partial = bridgeMinutes(hour, asset, SEED, 12, 15);
    expect(partial).toHaveLength(15);
    // и это ровно те же первые минутки, что и в полном часе
    expect(partial).toEqual(bridgeMinutes(hour, asset, SEED, 12).slice(0, 15));
  });
});
