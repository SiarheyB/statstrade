import { describe, it, expect } from "vitest";
import {
  earningsAt,
  earningsBetween,
  earningsTs,
  EARNINGS_PER_YEAR,
  EARNINGS_SHOCK_RANGE,
  newsForHour,
} from "@/lib/game/marketGen";
import type { Asset } from "@/engine/entities/types";

const stock = (id: string, name = id): Asset =>
  ({
    id,
    symbol: id,
    name,
    assetClass: "stock",
    sector: "tech",
    correlationGroup: "tech",
    baseVolatility: 0.3,
    baseDrift: 0.05,
    tickSize: 0.01,
    startPrice: 100,
  }) as unknown as Asset;

const forex = (id: string): Asset => ({ ...stock(id), assetClass: "forex" }) as Asset;

const YEAR = 365 * 24 * 3_600_000;
const from = Date.UTC(2026, 0, 1);

describe("календарь отчётностей", () => {
  it("дата известна заранее и не меняется: тот же сид даёт ту же дату", () => {
    expect(earningsTs("s", "A", 3)).toBe(earningsTs("s", "A", 3));
    expect(earningsTs("s", "A", 3)).not.toBe(earningsTs("other", "A", 3));
  });

  it("компания отчитывается четыре раза в год", () => {
    const events = earningsBetween("s", [stock("A")], from, from + YEAR);
    expect(events.length).toBe(EARNINGS_PER_YEAR);
  });

  it("разные компании отчитываются в разные дни — сезон растянут, а не в одну дату", () => {
    const assets = ["A", "B", "C", "D", "E", "F"].map((id) => stock(id));
    const events = earningsBetween("s", assets, from, from + YEAR / 4);
    const days = new Set(events.map((e) => Math.floor(e.ts / 86_400_000)));
    expect(days.size).toBeGreaterThan(1);
  });

  it("отчитываются только компании: у валютной пары отчётности нет", () => {
    expect(earningsBetween("s", [forex("EURUSD")], from, from + YEAR)).toEqual([]);
    expect(earningsAt("s", [forex("EURUSD")], from)).toEqual([]);
  });

  it("отчёт выходит новостью ровно в обещанный час", () => {
    const asset = stock("A", "Альфа");
    const events = earningsBetween("s", [asset], from, from + YEAR);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const hourIndex = Math.round(event.ts / 3_600_000);
      const news = newsForHour("s", hourIndex, [asset], 1, event.ts);
      const report = news.find((item) => item.assetId === asset.id && item.headline.includes("отчёт"));
      expect(report).toBeDefined();
      expect(report!.impact).toBe("high");
    }
  });

  it("отчёт бьёт по своей бумаге сильнее обычной новости", () => {
    const asset = stock("A", "Альфа");
    const [lo, hi] = EARNINGS_SHOCK_RANGE;
    for (const event of earningsBetween("s", [asset], from, from + YEAR)) {
      const hourIndex = Math.round(event.ts / 3_600_000);
      const report = newsForHour("s", hourIndex, [asset], 1, event.ts).find((item) => item.headline.includes("отчёт"))!;
      expect(Math.abs(report.shockPct)).toBeGreaterThanOrEqual(lo);
      expect(Math.abs(report.shockPct)).toBeLessThanOrEqual(hi);
    }
  });

  it("результат отчёта заранее не известен — иначе календарь стал бы подсказкой", () => {
    const assets = ["A", "B", "C", "D", "E", "F", "G", "H"].map((id) => stock(id));
    const signs = new Set(
      earningsBetween("s", assets, from, from + 2 * YEAR).map((event) => {
        const hourIndex = Math.round(event.ts / 3_600_000);
        const asset = assets.find((a) => a.id === event.assetId)!;
        const report = newsForHour("s", hourIndex, [asset], 1, event.ts).find((n) => n.headline.includes("отчёт"))!;
        return Math.sign(report.shockPct);
      }),
    );
    expect(signs.size).toBe(2);
  });

  it("в один час могут отчитаться несколько компаний, и все попадут в ленту", () => {
    // Сливать их в одну новость нельзя: игрок держит одну из бумаг, и именно
    // её отчёт объясняет, почему дёрнулся его портфель.
    const assets = Array.from({ length: 40 }, (_, i) => stock(`A${i}`));
    const events = earningsBetween("s", assets, from, from + YEAR);
    const byHour = new Map<number, number>();
    for (const event of events) byHour.set(event.ts, (byHour.get(event.ts) ?? 0) + 1);
    const crowded = [...byHour.entries()].find(([, count]) => count > 1);
    if (crowded) {
      const [ts, count] = crowded;
      const hourIndex = Math.round(ts / 3_600_000);
      const news = newsForHour("s", hourIndex, assets, 1, ts).filter((n) => n.headline.includes("отчёт"));
      expect(news.length).toBe(count);
    }
    expect(events.length).toBeGreaterThan(0);
  });
});
