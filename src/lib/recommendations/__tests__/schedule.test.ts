import { describe, it, expect } from "vitest";
import {
  BINANCE_DAILY_CLOSE_UTC_HOUR,
  RECOMPUTE_DELAY_MINUTES,
  isRecomputeDue,
  nextScheduledRun,
  scheduledRunForUtcDay,
} from "../schedule";

describe("recompute schedule", () => {
  it("fires 5 minutes after the Binance daily close (00:00 UTC)", () => {
    expect(BINANCE_DAILY_CLOSE_UTC_HOUR).toBe(0);
    expect(RECOMPUTE_DELAY_MINUTES).toBe(5);
    expect(scheduledRunForUtcDay(new Date("2026-08-13T14:00:00Z")).toISOString()).toBe(
      "2026-08-13T00:05:00.000Z",
    );
  });

  it("keeps the same UTC instant across the DST switch — Binance has no DST", () => {
    // Последнее воскресенье марта и октября: в Европе часы переводят, у биржи
    // закрытие дневки остаётся в 00:00 UTC.
    expect(scheduledRunForUtcDay(new Date("2026-03-29T12:00:00Z")).toISOString()).toBe(
      "2026-03-29T00:05:00.000Z",
    );
    expect(scheduledRunForUtcDay(new Date("2026-10-25T12:00:00Z")).toISOString()).toBe(
      "2026-10-25T00:05:00.000Z",
    );
  });

  describe("nextScheduledRun", () => {
    it("returns today's slot when it has not happened yet", () => {
      expect(nextScheduledRun(new Date("2026-08-13T00:01:00Z")).toISOString()).toBe(
        "2026-08-13T00:05:00.000Z",
      );
    });

    it("rolls over to tomorrow once today's slot has passed", () => {
      expect(nextScheduledRun(new Date("2026-08-13T00:06:00Z")).toISOString()).toBe(
        "2026-08-14T00:05:00.000Z",
      );
    });

    it("rolls the month and year over correctly", () => {
      expect(nextScheduledRun(new Date("2026-12-31T23:00:00Z")).toISOString()).toBe(
        "2027-01-01T00:05:00.000Z",
      );
    });
  });

  describe("isRecomputeDue", () => {
    const beforeSlot = new Date("2026-08-13T00:02:00Z");
    const afterSlot = new Date("2026-08-13T00:07:00Z");

    it("is not due before the slot", () => {
      expect(isRecomputeDue(beforeSlot, null)).toBe(false);
    });

    it("is due after the slot when nothing has been computed yet", () => {
      expect(isRecomputeDue(afterSlot, null)).toBe(true);
    });

    it("is due when the last run is older than today's slot", () => {
      expect(isRecomputeDue(afterSlot, new Date("2026-08-12T00:05:30Z"))).toBe(true);
    });

    it("is not due again once today's slot has already been run", () => {
      expect(isRecomputeDue(afterSlot, new Date("2026-08-13T00:05:30Z"))).toBe(false);
    });

    it("catches up a slot missed while the app was down", () => {
      // Приложение лежало всю ночь и поднялось днём — пересчёт должен пойти
      // сразу, а не ждать следующих суток.
      expect(isRecomputeDue(new Date("2026-08-13T14:00:00Z"), new Date("2026-08-11T00:05:00Z"))).toBe(true);
    });
  });
});
