import { describe, it, expect } from "vitest";
import {
  TRADING_SESSIONS,
  sessionWindows,
  sessionTodayWindow,
  zonedWallToUtcMs,
  MAX_SESSION_SPAN_MS,
} from "@/lib/tradingSessions";

const hhmmUtc = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const day = (iso: string) => Date.parse(iso);

describe("tradingSessions", () => {
  describe("zonedWallToUtcMs — переход на летнее время", () => {
    it("Лондон зимой открывается в 08:00 UTC, летом — в 07:00", () => {
      // 15 января (GMT) и 15 июля (BST) 2026
      expect(hhmmUtc(zonedWallToUtcMs(2026, 0, 15, 8 * 60, "Europe/London"))).toBe("08:00");
      expect(hhmmUtc(zonedWallToUtcMs(2026, 6, 15, 8 * 60, "Europe/London"))).toBe("07:00");
    });

    it("Нью-Йорк зимой открывается в 13:00 UTC, летом — в 12:00", () => {
      expect(hhmmUtc(zonedWallToUtcMs(2026, 0, 15, 8 * 60, "America/New_York"))).toBe("13:00");
      expect(hhmmUtc(zonedWallToUtcMs(2026, 6, 15, 8 * 60, "America/New_York"))).toBe("12:00");
    });

    it("Токио всегда 00:00 UTC — перехода на летнее время в Японии нет", () => {
      expect(hhmmUtc(zonedWallToUtcMs(2026, 0, 15, 9 * 60, "Asia/Tokyo"))).toBe("00:00");
      expect(hhmmUtc(zonedWallToUtcMs(2026, 6, 15, 9 * 60, "Asia/Tokyo"))).toBe("00:00");
    });

    it("в день перевода часов окно не разъезжается", () => {
      // 8 марта 2026 — переход в США, 29 марта — в Британии
      expect(hhmmUtc(zonedWallToUtcMs(2026, 2, 9, 8 * 60, "America/New_York"))).toBe("12:00");
      expect(hhmmUtc(zonedWallToUtcMs(2026, 2, 30, 8 * 60, "Europe/London"))).toBe("07:00");
    });
  });

  describe("sessionWindows", () => {
    it("отдаёт три сессии за сутки в правильном порядке", () => {
      const from = day("2026-08-24T00:00:00Z");
      const to = day("2026-08-25T00:00:00Z");
      const w = sessionWindows(from, to, ["tokyo", "london", "newYork"]);
      expect(w.map((x) => x.id)).toEqual(["tokyo", "london", "newYork"]);
      expect(hhmmUtc(w[0].start)).toBe("00:00"); // Токио 09:00 JST
      expect(hhmmUtc(w[1].start)).toBe("07:00"); // Лондон 08:00 BST
      expect(hhmmUtc(w[2].start)).toBe("12:00"); // Нью-Йорк 08:00 EDT
    });

    it("возвращает только включённые сессии", () => {
      const from = day("2026-08-24T00:00:00Z");
      const to = day("2026-08-25T00:00:00Z");
      expect(sessionWindows(from, to, ["london"]).map((x) => x.id)).toEqual(["london"]);
      expect(sessionWindows(from, to, [])).toEqual([]);
    });

    it("не рисует сессии в выходные", () => {
      // суббота 22 и воскресенье 23 августа 2026
      const w = sessionWindows(day("2026-08-22T00:00:00Z"), day("2026-08-24T00:00:00Z"), ["tokyo", "london", "newYork"]);
      // единственное, что может попасть — понедельничное открытие Токио в 00:00 UTC 24-го
      expect(w.every((x) => x.start >= day("2026-08-24T00:00:00Z") - 1)).toBe(true);
    });

    it("окна пересекают границы запрошенного диапазона, но не выходят за сутки запаса", () => {
      // окно в середине лондонской сессии: она должна попасть в выдачу целиком
      const from = day("2026-08-24T09:00:00Z");
      const to = day("2026-08-24T10:00:00Z");
      const w = sessionWindows(from, to, ["london"]);
      expect(w).toHaveLength(1);
      expect(hhmmUtc(w[0].start)).toBe("07:00");
      expect(hhmmUtc(w[0].end)).toBe("16:00");
    });

    it("не считает окна на слишком широком диапазоне", () => {
      const from = day("2026-01-01T00:00:00Z");
      const to = from + MAX_SESSION_SPAN_MS + 1;
      expect(sessionWindows(from, to, ["tokyo"])).toEqual([]);
    });

    it("не спотыкается о мусорный диапазон", () => {
      expect(sessionWindows(NaN, 1, ["tokyo"])).toEqual([]);
      expect(sessionWindows(100, 100, ["tokyo"])).toEqual([]);
      expect(sessionWindows(200, 100, ["tokyo"])).toEqual([]);
    });

    it("не дублирует сессии при перекрытии дней", () => {
      const w = sessionWindows(day("2026-08-24T00:00:00Z"), day("2026-08-27T00:00:00Z"), ["tokyo"]);
      const starts = w.map((x) => x.start);
      expect(new Set(starts).size).toBe(starts.length);
    });
  });

  it("sessionTodayWindow даёт сегодняшнее окно сессии", () => {
    const w = sessionTodayWindow("tokyo", day("2026-08-24T12:00:00Z"));
    expect(w).not.toBeNull();
    expect(hhmmUtc(w!.start)).toBe("00:00");
    expect(hhmmUtc(w!.end)).toBe("09:00");
  });

  it("у каждой сессии задан цвет и IANA-зона", () => {
    for (const s of TRADING_SESSIONS) {
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.tz).toContain("/");
      expect(s.closeMin).toBeGreaterThan(s.openMin);
    }
  });
});
