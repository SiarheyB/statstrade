import { describe, it, expect } from "vitest";
import { timeLeft } from "@/components/game/ChatPanel";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("сколько осталось до очистки чата", () => {
  it("больше суток считает днями", () => {
    expect(timeLeft(NOW + 2 * DAY + 3 * HOUR, NOW)).toEqual({ value: 2, unit: "days" });
  });

  it("меньше суток — часами", () => {
    expect(timeLeft(NOW + 5 * HOUR, NOW)).toEqual({ value: 5, unit: "hours" });
  });

  it("меньше часа — минутами", () => {
    expect(timeLeft(NOW + 20 * MINUTE, NOW)).toEqual({ value: 20, unit: "minutes" });
  });

  it("никогда не показывает ноль и не уходит в минус", () => {
    // «Очистится через 0» читается как поломка, а прошедшее время — как враньё.
    expect(timeLeft(NOW, NOW)).toEqual({ value: 1, unit: "minutes" });
    expect(timeLeft(NOW - DAY, NOW)).toEqual({ value: 1, unit: "minutes" });
  });

  it("возвращает КЛЮЧ единицы, а не готовую строку", () => {
    // Готовая строка была русской и в английской версии давала «in 2 д».
    expect(timeLeft(NOW + 3 * DAY, NOW).unit).toBe("days");
  });
});
