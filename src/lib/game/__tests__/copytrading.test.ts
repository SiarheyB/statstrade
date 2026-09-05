import { describe, it, expect } from "vitest";
import {
  MAX_SIGNAL_FEE_PCT,
  MIN_SIGNAL_FEE_PCT,
  SIGNAL_FRESH_MS,
  SIGNAL_PAGE_SIZE,
} from "@/lib/game/copytrading";

describe("границы копитрейдинга", () => {
  it("комиссия ведущего ограничена сверху и снизу", () => {
    // Ноль означал бы бесплатные сигналы (тогда незачем открываться), а сто —
    // что подписчик работает на ведущего целиком.
    expect(MIN_SIGNAL_FEE_PCT).toBeGreaterThan(0);
    expect(MAX_SIGNAL_FEE_PCT).toBeGreaterThan(MIN_SIGNAL_FEE_PCT);
    expect(MAX_SIGNAL_FEE_PCT).toBeLessThan(100);
  });

  it("сигнал живёт недолго — старый повторять уже поздно", () => {
    // Цена ушла: повторение по чужой отметке это уже не копирование, а
    // покупка по другой цене под чужим именем.
    expect(SIGNAL_FRESH_MS).toBeGreaterThan(0);
    expect(SIGNAL_FRESH_MS).toBeLessThanOrEqual(4 * 60 * 60 * 1000);
  });

  it("лента ограничена по длине", () => {
    expect(SIGNAL_PAGE_SIZE).toBeGreaterThan(0);
    expect(SIGNAL_PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});
