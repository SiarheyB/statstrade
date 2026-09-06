import { describe, it, expect } from "vitest";
import { DEFAULT_TF_BY_STYLE, fmtChartTime, TF_BY_STYLE, TF_MS } from "@/components/game/PriceChart";

// Склейка свечей переехала на сервер (src/lib/game/marketGen.ts): график
// теперь получает готовый ряд нужного таймфрейма, а не собирает его сам.

describe("наборы таймфреймов по стилям", () => {
  it("у скальпинга только внутридневные, дневного графика там нет", () => {
    expect(TF_BY_STYLE.scalping).toContain("1m");
    expect(TF_BY_STYLE.scalping).not.toContain("1d");
    expect(TF_BY_STYLE.scalping.at(-1)).toBe("1h");
  });

  it("у дейтрейдинга есть и минутки, и дневной — день нужно чем-то анализировать", () => {
    expect(TF_BY_STYLE.day).toContain("1m");
    expect(TF_BY_STYLE.day).toContain("1d");
  });

  it("у свинга и инвестиций есть недельный и месячный горизонт", () => {
    expect(TF_BY_STYLE.swing).toContain("1w");
    expect(TF_BY_STYLE.investing).toContain("1M");
    expect(TF_BY_STYLE.investing).not.toContain("1m");
  });

  it("таймфрейм по умолчанию входит в набор своего стиля", () => {
    for (const style of Object.keys(TF_BY_STYLE)) {
      expect(TF_BY_STYLE[style]).toContain(DEFAULT_TF_BY_STYLE[style]);
    }
  });

  it("каждый таймфрейм из наборов имеет известную длительность и они возрастают", () => {
    for (const list of Object.values(TF_BY_STYLE)) {
      const durations = list.map((tf) => TF_MS[tf]);
      expect(durations.every((d) => typeof d === "number" && d > 0)).toBe(true);
      for (let i = 1; i < durations.length; i++) expect(durations[i]).toBeGreaterThan(durations[i - 1]);
    }
  });
});

describe("подписи на оси времени", () => {
  const ts = new Date(2026, 8, 5, 14, 37).getTime(); // 5 сентября 2026, 14:37

  // Название дня недели и месяца зависит от локали окружения, поэтому
  // проверяем состав подписи, а не точную строку.
  it("внутри дня — день недели, дата И время", () => {
    // Одних часов мало: с расписанием торгов между соседними подписями
    // может лежать ночь или целые выходные, и по «14:37» этого не видно.
    for (const tf of ["1m", "5m", "15m"] as const) {
      const label = fmtChartTime(ts, TF_MS[tf]);
      expect(label).toMatch(/05\.09/);
      expect(label).toMatch(/14:37/);
    }
  });

  it("на часовом — та же дата со временем", () => {
    // Минуты не обрезаем: подписи оси стоят не на самих свечах, а в
    // произвольных точках окна (ось идёт по номерам баров), и «14:00» на
    // отметке 14:37 было бы неправдой.
    const label = fmtChartTime(ts, TF_MS["1h"]);
    expect(label).toMatch(/05\.09/);
    expect(label).toMatch(/14:37/);
  });

  it("на дневном время не нужно — только день недели и дата", () => {
    const label = fmtChartTime(ts, TF_MS["1d"]);
    expect(label).toMatch(/05\.09/);
    expect(label).not.toMatch(/\d\d:\d\d/);
  });

  it("на недельном появляется год", () => {
    expect(fmtChartTime(ts, TF_MS["1w"])).toBe("05.09.26");
  });

  it("на месячном — месяц и год, без числа", () => {
    const label = fmtChartTime(ts, TF_MS["1M"]);
    expect(label).toMatch(/26$/);
    expect(label).not.toMatch(/05\./);
  });
});
