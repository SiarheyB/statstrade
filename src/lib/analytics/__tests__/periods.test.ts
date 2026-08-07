import { describe, it, expect } from "vitest";
import {
  periodStart,
  periodEnd,
  localDayKey,
  bucketByLocalDay,
  sumInPeriod,
  type HourBucket,
} from "@/lib/analytics/periods";

// 2026-03-14 — суббота; 2026-03-15 — воскресенье (пограничный день недели).
const SAT = new Date("2026-03-14T12:00:00Z");
const SUN = new Date("2026-03-15T12:00:00Z");

const iso = (ms: number) => new Date(ms).toISOString();

function hour(isoStr: string, over: Partial<HourBucket> = {}): HourBucket {
  return {
    hour: new Date(isoStr),
    netPnl: 0, wins: 0, losses: 0, winR: 0, lossR: 0, trades: 0,
    ...over,
  };
}

describe("periodStart / periodEnd в UTC", () => {
  it("начало периода: день / неделя (с понедельника) / месяц / год", () => {
    expect(periodStart("day", SAT, 0)).toBe(Date.UTC(2026, 2, 14));
    expect(periodStart("week", SAT, 0)).toBe(Date.UTC(2026, 2, 9)); // пн 9 марта
    expect(periodStart("week", SUN, 0)).toBe(Date.UTC(2026, 2, 9)); // вс — та же неделя
    expect(periodStart("month", SAT, 0)).toBe(Date.UTC(2026, 2, 1));
    expect(periodStart("year", SAT, 0)).toBe(Date.UTC(2026, 0, 1));
  });

  it("конец периода = начало следующего", () => {
    expect(periodEnd("day", SAT, 0)).toBe(Date.UTC(2026, 2, 15));
    expect(periodEnd("week", SAT, 0)).toBe(Date.UTC(2026, 2, 16));
    expect(periodEnd("month", SAT, 0)).toBe(Date.UTC(2026, 3, 1));
    expect(periodEnd("year", SAT, 0)).toBe(Date.UTC(2027, 0, 1));
  });

  it("в воскресенье неделя заканчивается завтра, а не через 8 дней", () => {
    expect(periodEnd("week", SUN, 0)).toBe(Date.UTC(2026, 2, 16));
  });

  it("сетка периодов без дыр и нахлёстов", () => {
    for (const p of ["day", "week", "month", "year"] as const) {
      expect(periodEnd(p, SAT, 0)).toBeGreaterThan(periodStart(p, SAT, 0));
      expect(periodStart(p, new Date(periodEnd(p, SAT, 0)), 0)).toBe(periodEnd(p, SAT, 0));
    }
  });
});

describe("periodStart в таймзоне пользователя", () => {
  it("сутки начинаются в локальную полночь, а не в UTC-полночь", () => {
    // UTC+3: полночь 14 марта по локальному = 13 марта 21:00Z.
    expect(iso(periodStart("day", SAT, 180))).toBe("2026-03-13T21:00:00.000Z");
    // UTC-5: полночь 14 марта по локальному = 14 марта 05:00Z.
    expect(iso(periodStart("day", SAT, -300))).toBe("2026-03-14T05:00:00.000Z");
  });

  it("сдвиг может перевести момент в другие локальные сутки", () => {
    // 2026-03-14T23:30Z для UTC+3 — это уже 15 марта 02:30 по локальному.
    const lateUtc = new Date("2026-03-14T23:30:00Z");
    expect(iso(periodStart("day", lateUtc, 0))).toBe("2026-03-14T00:00:00.000Z");
    expect(iso(periodStart("day", lateUtc, 180))).toBe("2026-03-14T21:00:00.000Z");
  });

  it("месяц и год тоже считаются по локальному календарю", () => {
    // 1 января 00:30Z при UTC-5 — это ещё 31 декабря по локальному времени.
    const newYear = new Date("2026-01-01T00:30:00Z");
    expect(iso(periodStart("year", newYear, 0))).toBe("2026-01-01T00:00:00.000Z");
    expect(iso(periodStart("year", newYear, -300))).toBe("2025-01-01T05:00:00.000Z");
    expect(iso(periodStart("month", newYear, -300))).toBe("2025-12-01T05:00:00.000Z");
  });

  it("конец периода согласован с началом при любом сдвиге", () => {
    for (const off of [0, 180, -300, 840, -720]) {
      for (const p of ["day", "week", "month", "year"] as const) {
        const end = periodEnd(p, SAT, off);
        expect(end).toBeGreaterThan(periodStart(p, SAT, off));
        expect(periodStart(p, new Date(end), off)).toBe(end);
      }
    }
  });
});

describe("localDayKey", () => {
  it("отдаёт локальную дату, а не UTC", () => {
    const ms = Date.parse("2026-03-14T23:30:00Z");
    expect(localDayKey(ms, 0)).toBe("2026-03-14");
    expect(localDayKey(ms, 180)).toBe("2026-03-15");
    expect(localDayKey(ms, -300)).toBe("2026-03-14");
  });
});

describe("bucketByLocalDay", () => {
  const hours = [
    hour("2026-03-14T10:00:00Z", { netPnl: -100, losses: 1, trades: 1, lossR: -1 }),
    hour("2026-03-14T22:00:00Z", { netPnl: -50, losses: 1, trades: 1, lossR: -0.5 }),
    hour("2026-03-15T01:00:00Z", { netPnl: 200, wins: 1, trades: 1, winR: 2 }),
  ];

  it("в UTC даёт два дня", () => {
    const days = bucketByLocalDay(hours, 0);
    expect(days.map((d) => d.date)).toEqual(["2026-03-14", "2026-03-15"]);
    expect(days[0].netPnl).toBe(-150);
    expect(days[1].netPnl).toBe(200);
  });

  it("в UTC+3 22:00Z уезжает на следующие локальные сутки", () => {
    const days = bucketByLocalDay(hours, 180);
    expect(days.map((d) => d.date)).toEqual(["2026-03-14", "2026-03-15"]);
    expect(days[0].netPnl).toBe(-100);
    expect(days[1].netPnl).toBe(150); // -50 + 200
    expect(days[1].wins).toBe(1);
    expect(days[1].losses).toBe(1);
  });

  it("общая сумма не зависит от таймзоны", () => {
    for (const off of [0, 180, -300, 840]) {
      const total = bucketByLocalDay(hours, off).reduce((s, d) => s + d.netPnl, 0);
      expect(total).toBeCloseTo(50, 9);
    }
  });

  it("суммирует R-разрезы по дню", () => {
    const days = bucketByLocalDay(hours, 0);
    expect(days[0].lossR).toBeCloseTo(-1.5, 9);
    expect(days[1].winR).toBe(2);
  });
});

describe("sumInPeriod", () => {
  const hours = [
    hour("2026-03-14T10:00:00Z", { netPnl: -100, losses: 1, trades: 1 }),
    hour("2026-03-14T22:00:00Z", { netPnl: -50, losses: 1, trades: 1 }),
    hour("2026-03-15T01:00:00Z", { netPnl: 200, wins: 1, trades: 1 }),
    hour("2026-03-15T23:00:00Z", { netPnl: -30, losses: 1, trades: 1 }),
  ];
  const now = new Date("2026-03-15T01:30:00Z");

  it("«сегодня» в UTC — только час 01:00", () => {
    expect(sumInPeriod(hours, "day", now, 0)).toEqual({ netPnl: 200, wins: 1, losses: 0 });
  });

  it("«сегодня» в UTC+3 включает вчерашний по UTC вечер", () => {
    expect(sumInPeriod(hours, "day", now, 180)).toEqual({ netPnl: 150, wins: 1, losses: 1 });
  });

  it("не захватывает часы позже now", () => {
    // 2026-03-15T23:00Z наступит позже now — в окно попадать не должен.
    const week = sumInPeriod(hours, "week", now, 0);
    expect(week.netPnl).toBe(50); // -100 -50 +200, без -30
  });

  it("бакет, внутрь которого попадает now, учитывается целиком", () => {
    const inside = sumInPeriod([hour("2026-03-15T01:00:00Z", { netPnl: 7, trades: 1 })], "day", now, 0);
    expect(inside.netPnl).toBe(7);
  });
});
