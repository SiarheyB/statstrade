import { describe, it, expect } from "vitest";
import {
  applyNewsShock,
  generateNews,
  shockFactor,
  GLOBAL_TARGET,
  IMPACT_WEIGHTS,
  maybeGenerateNews,
  newsAffectsAsset,
  newsVolMultipliers,
  NEWS_TEMPLATES,
  pickImpact,
  pickDirection,
  pickTemplate,
  pruneExpiredNews,
  sectorLabel,
} from "@/engine/market/newsEngine";
import { mulberry32 } from "@/engine/rng";
import type { Asset, NewsEvent } from "@/engine/entities/types";

const assets: Asset[] = [
  { id: "A", symbol: "A", name: "Alpha Corp", assetClass: "stock", sector: "tech", correlationGroup: "tech_stocks", baseVolatility: 0.3, baseDrift: 0.05, tickSize: 0.01, tradingHours: "session" },
  { id: "B", symbol: "B", name: "Beta Corp", assetClass: "stock", sector: "tech", correlationGroup: "tech_stocks", baseVolatility: 0.3, baseDrift: 0.05, tickSize: 0.01, tradingHours: "session" },
  { id: "C", symbol: "C", name: "Gamma Energy", assetClass: "stock", sector: "energy", correlationGroup: "energy_stocks", baseVolatility: 0.3, baseDrift: 0.05, tickSize: 0.01, tradingHours: "session" },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("каталог шаблонов", () => {
  it("у каждого шаблона проставлена полярность и осмысленный диапазон шока", () => {
    for (const t of NEWS_TEMPLATES) {
      expect(["positive", "negative", "mixed"]).toContain(t.polarity);
      const [lo, hi] = t.shockRange;
      expect(lo).toBeGreaterThan(0);
      expect(hi).toBeGreaterThanOrEqual(lo);
    }
  });

  it("в каталоге есть шаблоны всех четырёх уровней важности", () => {
    for (const impact of Object.keys(IMPACT_WEIGHTS)) {
      expect(NEWS_TEMPLATES.some((t) => t.impact === impact)).toBe(true);
    }
  });

  it("веса важности дают в сумме единицу", () => {
    const total = Object.values(IMPACT_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("pickImpact", () => {
  it("мелкие новости выпадают часто, чёрные лебеди — почти никогда", () => {
    const rng = mulberry32(42);
    const counts: Record<string, number> = { low: 0, medium: 0, high: 0, black_swan: 0 };
    for (let i = 0; i < 5_000; i++) counts[pickImpact(rng)]++;
    expect(counts.low).toBeGreaterThan(counts.medium);
    expect(counts.medium).toBeGreaterThan(counts.high);
    expect(counts.black_swan).toBeLessThan(counts.high);
  });
});

describe("выбор направления и шаблона", () => {
  it("направление — честная монета, слегка смещённая режимом", () => {
    // ровно на границе: бычий режим делает событие позитивным, кризис — нет
    expect(pickDirection(2, () => 0.5)).toBe(1);
    expect(pickDirection(-3.5, () => 0.5)).toBe(-1);
  });

  it("под минус не подставляется однозначно позитивный шаблон, и наоборот", () => {
    const rng = mulberry32(31);
    for (let i = 0; i < 200; i++) {
      expect(pickTemplate("high", -1, rng)!.polarity).not.toBe("positive");
      expect(pickTemplate("high", 1, rng)!.polarity).not.toBe("negative");
    }
  });

  // Регрессия по балансу: в каталоге негативных шаблонов вдвое больше
  // позитивных, и генерация «шаблон → знак» превращала новостной поток в
  // постоянный нисходящий снос (на прогоне рынок падал на 80% за игровой
  // год без кризиса). Знак должен зависеть от монеты, а не от каталога.
  it("новостной поток в нейтральном режиме не имеет систематического знака", () => {
    const rng = mulberry32(101);
    let sum = 0;
    let positives = 0;
    let count = 0;
    for (let i = 0; i < 4_000; i++) {
      const news = generateNews(assets, 0.2, i * 1000, 60_000, rng);
      if (!news) continue;
      if (news.priceShockPct > 0) positives++;
      sum += news.priceShockPct;
      count++;
    }
    // Смотрим прежде всего на ДОЛЮ позитивных: средний шок шумит из-за
    // редких чёрных лебедей (±15-40% против ±1% у мелких новостей), и на
    // нём порог пришлось бы делать бессмысленно широким.
    const positiveShare = positives / count;
    expect(positiveShare).toBeGreaterThan(0.45);
    expect(positiveShare).toBeLessThan(0.58);
    expect(Math.abs(sum / count)).toBeLessThan(0.006);
  });

  it("в кризисе поток, наоборот, смещён вниз", () => {
    const rng = mulberry32(102);
    let sum = 0;
    for (let i = 0; i < 2_000; i++) sum += generateNews(assets, -3.5, i * 1000, 60_000, rng)!.priceShockPct;
    expect(sum).toBeLessThan(0);
  });
});

describe("generateNews", () => {
  it("собирает заголовок, подставляя имя актива вместо плейсхолдера", () => {
    const news = generateNews(assets, 1, 1_000, 60_000, mulberry32(5));
    expect(news).not.toBeNull();
    expect(news!.headline).not.toContain("{");
    expect(news!.affectedAssets.length).toBeGreaterThan(0);
  });

  it("время истечения фиксируется сразу и зависит от длины свечи", () => {
    const short = generateNews(assets, 1, 0, 1_000, mulberry32(11))!;
    const long = generateNews(assets, 1, 0, 60_000, mulberry32(11))!;
    expect(short.expiresAt).toBeLessThan(long.expiresAt);
    expect(short.expiresAt).toBe(short.volatilityDurationCandles * 1_000);
  });

  it("на пустом списке активов молчит, а не падает", () => {
    expect(generateNews([], 1, 0, 60_000, mulberry32(1))).toBeNull();
  });

  it("секторная новость затрагивает все бумаги сектора, глобальная — весь рынок", () => {
    // Прогоняем много новостей и проверяем инварианты каждой.
    const rng = mulberry32(77);
    for (let i = 0; i < 300; i++) {
      const news = generateNews(assets, 1, i * 1000, 60_000, rng)!;
      if (news.affectedAssets.includes(GLOBAL_TARGET)) {
        expect(news.affectedAssets).toEqual([GLOBAL_TARGET]);
      } else if (news.affectedSectors?.length) {
        // affectedSectors хранит СЫРОЙ ключ сектора (данные), а не подпись:
        // подпись подставляется только в заголовок.
        const sector = news.affectedSectors[0];
        const expected = assets.filter((a) => a.sector === sector).map((a) => a.id);
        expect(news.affectedAssets.sort()).toEqual(expected.sort());
      } else {
        expect(news.affectedAssets).toHaveLength(1);
      }
    }
  });
});

describe("maybeGenerateNews", () => {
  it("за нулевой интервал новостей не бывает", () => {
    expect(maybeGenerateNews(0, assets, 1, 0, 60_000, () => 0)).toBeNull();
  });

  it("частота растёт с длиной интервала", () => {
    const count = (dtMs: number) => {
      const rng = mulberry32(9);
      let n = 0;
      for (let i = 0; i < 500; i++) if (maybeGenerateNews(dtMs, assets, 1, i * dtMs, 60_000, rng)) n++;
      return n;
    };
    expect(count(MS_PER_DAY)).toBeGreaterThan(count(MS_PER_DAY / 24));
  });
});

describe("шок и всплеск волатильности", () => {
  const news: NewsEvent = {
    id: "n1",
    timestamp: 0,
    headline: "test",
    affectedAssets: ["A"],
    impact: "high",
    priceShockPct: -0.1,
    volatilityMultiplier: 2.5,
    volatilityDurationCandles: 20,
    expiresAt: 20_000,
    templateId: "NEWS_TEST",
  };

  it("двигает только затронутые бумаги", () => {
    const prices = applyNewsShock({ A: 100, B: 100 }, news);
    // Падение — деление на (1+|x|), а не умножение на (1−|x|): см.
    // shockFactor. −10% здесь означает «во столько же раз, во сколько +10%
    // поднимает», то есть 100 / 1.1.
    expect(prices.A).toBeCloseTo(100 / 1.1, 10);
    expect(prices.B).toBe(100);
  });

  // Регрессия по балансу экономики: пара взаимно обратных новостей обязана
  // возвращать цену РОВНО на место. С наивным (1±x) не возвращала, и на
  // полутора тысячах новостей за три игровых года рынок съедало в ноль.
  it("плюс и минус одного размера компенсируют друг друга точно", () => {
    const up = applyNewsShock({ A: 100 }, { ...news, priceShockPct: 0.1 });
    const back = applyNewsShock(up, { ...news, priceShockPct: -0.1 });
    expect(back.A).toBeCloseTo(100, 10);
  });

  it("глобальная новость двигает весь рынок", () => {
    const prices = applyNewsShock({ A: 100, B: 50 }, { ...news, affectedAssets: [GLOBAL_TARGET], priceShockPct: 0.2 });
    expect(prices.A).toBeCloseTo(120, 10);
    expect(prices.B).toBeCloseTo(60, 10);
  });

  it("цена не уходит в отрицательную область даже при шоке больше 100%", () => {
    const prices = applyNewsShock({ A: 100 }, { ...news, priceShockPct: -1.5 });
    expect(prices.A).toBeGreaterThan(0);
    expect(shockFactor(-1.5)).toBeLessThan(1);
  });

  it("множитель волатильности действует до истечения и только на своих активах", () => {
    const before = newsVolMultipliers([news], 10_000, ["A", "B"]);
    expect(before.A).toBe(2.5);
    expect(before.B).toBe(1);
    const after = newsVolMultipliers([news], 30_000, ["A", "B"]);
    expect(after.A).toBe(1);
  });

  it("две новости по одной бумаге не перемножаются — берётся сильнейшая", () => {
    const weaker: NewsEvent = { ...news, id: "n2", volatilityMultiplier: 1.6 };
    const result = newsVolMultipliers([news, weaker], 1_000, ["A"]);
    expect(result.A).toBe(2.5);
  });

  it("истёкшие новости выпадают из активных", () => {
    expect(pruneExpiredNews([news], 30_000)).toEqual([]);
    expect(pruneExpiredNews([news], 5_000)).toEqual([news]);
  });

  it("newsAffectsAsset понимает глобальную цель", () => {
    expect(newsAffectsAsset(news, "A")).toBe(true);
    expect(newsAffectsAsset(news, "B")).toBe(false);
    expect(newsAffectsAsset({ ...news, affectedAssets: [GLOBAL_TARGET] }, "B")).toBe(true);
  });
});

describe("sectorLabel", () => {
  it("подставляет русское название сектора — шаблоны написаны по-русски", () => {
    expect(sectorLabel("real_estate")).toBe("недвижимость");
    expect(sectorLabel("tech")).toBe("технологии");
  });

  it("неизвестный сектор не ломает заголовок", () => {
    expect(sectorLabel("space_mining")).toBe("space mining");
  });
});
