import { describe, it, expect } from "vitest";
import { delta, isPeriod, localMidnightUtc, periodBounds, previousBounds } from "@/lib/traffic/periods";

// 19 августа 2026, 01:30 UTC. Для админа в UTC+3 это уже 04:30 того же дня,
// а для UTC-5 — ещё 18 августа, 20:30. На этом и проверяем границы суток.
const NOW = new Date("2026-08-19T01:30:00Z");

describe("localMidnightUtc", () => {
  it("полночь считается в зоне админа, а не в UTC", () => {
    expect(new Date(localMidnightUtc(NOW, 0)).toISOString()).toBe("2026-08-19T00:00:00.000Z");
    expect(new Date(localMidnightUtc(NOW, 180)).toISOString()).toBe("2026-08-18T21:00:00.000Z");
    expect(new Date(localMidnightUtc(NOW, -300)).toISOString()).toBe("2026-08-18T05:00:00.000Z");
  });
});

describe("periodBounds", () => {
  it("«сегодня» — от локальной полуночи, с часовыми корзинами", () => {
    const b = periodBounds("today", NOW, 180);
    expect(b.from.toISOString()).toBe("2026-08-18T21:00:00.000Z");
    expect(b.bucket).toBe("hour");
  });

  it("7 дней включают сегодняшний день, т.е. отсчёт на 6 суток назад", () => {
    const b = periodBounds("7d", NOW, 0);
    expect(b.from.toISOString()).toBe("2026-08-13T00:00:00.000Z");
    expect(b.bucket).toBe("day");
  });

  it("30 и 90 дней", () => {
    expect(periodBounds("30d", NOW, 0).from.toISOString()).toBe("2026-07-21T00:00:00.000Z");
    expect(periodBounds("90d", NOW, 0).from.toISOString()).toBe("2026-05-22T00:00:00.000Z");
  });

  it("верхняя граница чуть впереди — незакрытая минута не теряется", () => {
    expect(periodBounds("today", NOW, 0).to.getTime()).toBe(NOW.getTime() + 60_000);
  });
});

describe("previousBounds / delta", () => {
  it("прошлый период той же длины примыкает к текущему", () => {
    const b = periodBounds("7d", NOW, 0);
    const p = previousBounds(b);
    expect(p.to.getTime()).toBe(b.from.getTime());
    expect(b.to.getTime() - b.from.getTime()).toBe(p.to.getTime() - p.from.getTime());
  });

  it("относительное изменение", () => {
    expect(delta(150, 100)).toBeCloseTo(0.5);
    expect(delta(50, 100)).toBeCloseTo(-0.5);
    expect(delta(0, 0)).toBe(0);
    expect(delta(10, 0)).toBeNull(); // рост с нуля в процентах не выражается
  });
});

describe("isPeriod", () => {
  it("валидирует значение из URL", () => {
    expect(isPeriod("7d")).toBe(true);
    expect(isPeriod("месяц")).toBe(false);
    expect(isPeriod(null)).toBe(false);
  });
});
