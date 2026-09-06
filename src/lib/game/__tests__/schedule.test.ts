import { describe, it, expect } from "vitest";
import { isMarketOpen, nextOpen, sessionOf } from "@/lib/game/schedule";
import { gapOpen, isQuietHour, MAX_GAP, newsForHour, scheduleBetween } from "@/lib/game/marketGen";
import type { Asset } from "@/engine/entities/types";

const utc = (iso: string) => new Date(`${iso}Z`).getTime();

describe("расписание торгов", () => {
  it("крипта не закрывается никогда — в этом её отличие от остальных рынков", () => {
    expect(sessionOf("crypto")).toBe("always");
    for (const ts of ["2026-09-05T03:00", "2026-09-06T12:00", "2026-09-07T21:30"]) {
      expect(isMarketOpen("crypto", utc(ts))).toBe(true);
    }
  });

  it("форекс стоит с пятничного вечера до вечера воскресенья", () => {
    expect(isMarketOpen("forex", utc("2026-09-04T20:59"))).toBe(true); // пятница до закрытия
    expect(isMarketOpen("forex", utc("2026-09-04T21:00"))).toBe(false); // пятница, закрылись
    expect(isMarketOpen("forex", utc("2026-09-05T12:00"))).toBe(false); // суббота целиком
    expect(isMarketOpen("forex", utc("2026-09-06T21:59"))).toBe(false); // воскресенье до открытия
    expect(isMarketOpen("forex", utc("2026-09-06T22:00"))).toBe(true); // воскресенье, открылись
    expect(isMarketOpen("forex", utc("2026-09-07T04:00"))).toBe(true); // азиатская сессия понедельника
  });

  it("металлы и нефть живут по форексному расписанию, а не биржевому", () => {
    expect(sessionOf("commodity")).toBe("forex");
    expect(isMarketOpen("commodity", utc("2026-09-07T04:00"))).toBe(true);
    expect(isMarketOpen("commodity", utc("2026-09-05T12:00"))).toBe(false);
  });

  it("акции торгуются только в дневную сессию будней", () => {
    expect(isMarketOpen("stock", utc("2026-09-07T13:59"))).toBe(false);
    expect(isMarketOpen("stock", utc("2026-09-07T14:00"))).toBe(true);
    expect(isMarketOpen("stock", utc("2026-09-07T20:59"))).toBe(true);
    expect(isMarketOpen("stock", utc("2026-09-07T21:00"))).toBe(false);
    expect(isMarketOpen("stock", utc("2026-09-05T16:00"))).toBe(false); // суббота
  });

  it("nextOpen возвращает сам момент, если рынок уже открыт", () => {
    const ts = utc("2026-09-07T15:00");
    expect(nextOpen("stock", ts)).toBe(ts);
  });

  it("после пятничного закрытия ближайшее открытие форекса — вечер воскресенья", () => {
    expect(nextOpen("forex", utc("2026-09-04T22:15"))).toBe(utc("2026-09-06T22:00"));
  });

  it("ночью ближайшее открытие акций — сегодняшние 14:00", () => {
    expect(nextOpen("stock", utc("2026-09-08T06:00"))).toBe(utc("2026-09-08T14:00"));
  });
});

describe("гэп на открытии", () => {
  const asset = (volatility: number): Asset =>
    ({
      id: "T",
      symbol: "T",
      name: "T",
      assetClass: "stock",
      sector: "tech",
      correlationGroup: "tech",
      baseVolatility: volatility,
      baseDrift: 0.05,
      tickSize: 0.01,
      startPrice: 100,
    }) as unknown as Asset;

  it("без перерыва разрыва нет", () => {
    expect(gapOpen(100, { seed: "s", asset: asset(0.35), index: 5, closedMs: 0, volModifier: 1 })).toBe(100);
  });

  it("выходные по акции дают разрыв в разумных единицах процента", () => {
    const weekend = 62 * 3_600_000;
    const gaps: number[] = [];
    for (let i = 0; i < 400; i++) {
      const open = gapOpen(100, { seed: "s", asset: asset(0.35), index: i, closedMs: weekend, volModifier: 1 });
      gaps.push(Math.abs(open - 100));
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    // Разрыв должен быть заметен на графике, но не превращать понедельник в
    // обвал: сотые доли процента незаметны, десять процентов — катастрофа.
    expect(mean).toBeGreaterThan(0.1);
    expect(mean).toBeLessThan(3);
  });

  it("спокойный инструмент рвётся слабее буйного", () => {
    const weekend = 62 * 3_600_000;
    const avg = (vol: number) => {
      let sum = 0;
      for (let i = 0; i < 300; i++) {
        sum += Math.abs(gapOpen(100, { seed: "s", asset: asset(vol), index: i, closedMs: weekend, volModifier: 1 }) - 100);
      }
      return sum / 300;
    };
    expect(avg(0.08)).toBeLessThan(avg(0.5));
  });

  it("длинный перерыв не пробивает потолок разрыва", () => {
    const year = 365 * 24 * 3_600_000;
    for (let i = 0; i < 200; i++) {
      const open = gapOpen(100, { seed: "s", asset: asset(1.2), index: i, closedMs: year, volModifier: 3 });
      expect(Math.abs(Math.log(open / 100))).toBeLessThanOrEqual(MAX_GAP + 1e-9);
    }
  });
});

describe("новости в нерабочее время", () => {
  const asset = {
    id: "T",
    symbol: "T",
    name: "T",
    assetClass: "stock",
    sector: "tech",
    correlationGroup: "tech",
    baseVolatility: 0.3,
    baseDrift: 0.05,
    tickSize: 0.01,
    startPrice: 100,
  } as unknown as Parameters<typeof newsForHour>[2][number];

  it("суббота, воскресенье и ночь считаются тихим временем", () => {
    expect(isQuietHour(utc("2026-09-05T12:00"))).toBe(true); // суббота
    expect(isQuietHour(utc("2026-09-06T12:00"))).toBe(true); // воскресенье
    expect(isQuietHour(utc("2026-09-07T02:00"))).toBe(true); // ночь понедельника
    expect(isQuietHour(utc("2026-09-07T23:00"))).toBe(true); // поздний вечер
    expect(isQuietHour(utc("2026-09-07T12:00"))).toBe(false); // рабочий день
  });

  it("в выходные новости выходят, но заметно реже", () => {
    // Считаем по одному и тому же ряду часов: разница только в том, что
    // одному сообщается «тихое время», а другому нет.
    let workday = 0;
    let weekend = 0;
    const monday = utc("2026-09-07T09:00");
    const saturday = utc("2026-09-05T09:00");
    for (let i = 0; i < 2000; i++) {
      workday += newsForHour("s", i, [asset], 1, monday + i * 3_600_000 * 0).length;
      weekend += newsForHour("s", i, [asset], 1, saturday).length;
    }
    expect(weekend).toBeGreaterThan(0); // мир не замирает
    expect(weekend).toBeLessThan(workday * 0.6); // но лента заметно тише
  });
});

describe("календарь запланированных событий", () => {
  const asset = {
    id: "T",
    symbol: "T",
    name: "T",
    assetClass: "stock",
    sector: "tech",
    correlationGroup: "tech",
    baseVolatility: 0.3,
    baseDrift: 0.05,
    tickSize: 0.01,
    startPrice: 100,
  } as unknown as Parameters<typeof newsForHour>[2][number];

  const WEEK = 7 * 24 * 3_600_000;
  const from = utc("2026-09-07T00:00");

  it("расписание детерминировано: тот же сид и промежуток дают то же самое", () => {
    const a = scheduleBetween("s", from, from + WEEK);
    const b = scheduleBetween("s", from, from + WEEK);
    expect(a).toEqual(b);
  });

  it("разные сиды дают разные расписания", () => {
    const a = scheduleBetween("s", from, from + WEEK);
    const b = scheduleBetween("other", from, from + WEEK);
    expect(a).not.toEqual(b);
  });

  it("за неделю набирается несколько публикаций, но не десятки", () => {
    const week = scheduleBetween("s", from, from + WEEK);
    expect(week.length).toBeGreaterThan(0);
    expect(week.length).toBeLessThanOrEqual(2 * 5); // максимум два слота в будний день
  });

  it("в выходные макростатистику не публикуют", () => {
    for (const event of scheduleBetween("s", from, from + 3 * WEEK)) {
      const day = new Date(event.ts).getUTCDay();
      expect(day === 0 || day === 6).toBe(false);
    }
  });

  it("публикации приходятся на рабочие часы", () => {
    for (const event of scheduleBetween("s", from, from + 3 * WEEK)) {
      const hour = new Date(event.ts).getUTCHours();
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThan(18);
    }
  });

  it("обещанное календарём событие обязательно выходит в свой час", () => {
    // Календарь, который иногда врёт, бесполезен: готовиться по нему
    // перестанут после первого промаха.
    const events = scheduleBetween("s", from, from + 3 * WEEK);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const hourIndex = Math.round(event.ts / 3_600_000);
      const news = newsForHour("s", hourIndex, [asset], 1, event.ts);
      expect(news.length).toBeGreaterThan(0);
      expect(news[0].impact).toBe(event.impact);
    }
  });

  it("календарь не выдаёт результат: заранее известны время, сила и заголовок", () => {
    // Направления и величины шока в событии нет и быть не должно — иначе
    // игра свелась бы к чтению будущего.
    const event = scheduleBetween("s", from, from + 3 * WEEK)[0];
    expect(event).toBeDefined();
    expect(Object.keys(event).sort()).toEqual(["eventId", "impact", "title", "ts"]);
    expect(event).not.toHaveProperty("shockPct");
  });

  it("заголовки готовы целиком — без дыр от подстановок", () => {
    // Шаблоны обычных новостей писались под подстановку инструмента или
    // отрасли, и в календаре, где ни того ни другого ещё нет, получалось
    // «отчёт по — без сюрпризов». У макрособытий свои формулировки.
    for (const event of scheduleBetween("s", from, from + 6 * WEEK)) {
      expect(event.title).not.toMatch(/[{}]/);
      expect(event.title.length).toBeGreaterThan(10);
    }
  });

  it("обещанный заголовок и выходит: игрок ждал ставку — увидел ставку", () => {
    for (const event of scheduleBetween("s", from, from + 3 * WEEK)) {
      const hourIndex = Math.round(event.ts / 3_600_000);
      const news = newsForHour("s", hourIndex, [asset], 1, event.ts);
      expect(news[0].headline).toBe(event.title);
    }
  });

  it("макрособытие бьёт по всему рынку, а не по одной бумаге", () => {
    for (const event of scheduleBetween("s", from, from + 3 * WEEK)) {
      const hourIndex = Math.round(event.ts / 3_600_000);
      const news = newsForHour("s", hourIndex, [asset], 1, event.ts);
      expect(news[0].assetId).toBeNull();
      expect(news[0].sector).toBeNull();
    }
  });

  it("направление публикации не предопределено — иначе календарь стал бы подсказкой", () => {
    const events = scheduleBetween("s", from, from + 26 * WEEK);
    const signs = new Set(
      events.map((event) => {
        const hourIndex = Math.round(event.ts / 3_600_000);
        return Math.sign(newsForHour("s", hourIndex, [asset], 1, event.ts)[0]?.shockPct ?? 0);
      }),
    );
    expect(signs.size).toBeGreaterThan(1);
  });
});
