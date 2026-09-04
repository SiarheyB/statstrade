import { describe, it, expect } from "vitest";
import {
  botHasPosition,
  botPositionSize,
  botSignal,
  botSlots,
  botStopLoss,
  botTakeProfit,
  defaultBot,
  MIN_CANDLES_FOR_SIGNAL,
  type AlgoBot,
} from "@/engine/player/algoBots";
import type { Candle, Position } from "@/engine/entities/types";

function bot(overrides: Partial<AlgoBot> = {}): AlgoBot {
  return { id: "b1", ...defaultBot("A"), ...overrides };
}

function series(values: number[]): Candle[] {
  return values.map((v, i) => ({ timestamp: i * 1000, open: v, high: v * 1.005, low: v * 0.995, close: v, volume: 0 }));
}

const flat = series(Array.from({ length: 30 }, () => 100));
const rising = series(Array.from({ length: 30 }, (_, i) => 90 + i));
const falling = series(Array.from({ length: 30 }, (_, i) => 120 - i));

describe("botSignal", () => {
  it("молчит, пока истории мало — торговать вслепую бот не должен", () => {
    expect(botSignal(bot(), series([100, 101, 102]), 102)).toBeNull();
    expect(MIN_CANDLES_FOR_SIGNAL).toBeGreaterThan(20);
  });

  it("трендовый бот идёт в лонг на росте и в шорт на падении", () => {
    expect(botSignal(bot({ strategy: "trend" }), rising, 120)).toBe("long");
    expect(botSignal(bot({ strategy: "trend" }), falling, 90)).toBe("short");
  });

  it("трендовый бот молчит на плоском рынке — нет тренда, нет сделки", () => {
    expect(botSignal(bot({ strategy: "trend" }), flat, 100)).toBeNull();
  });

  it("контртрендовый бот покупает отклонение вниз и продаёт вверх", () => {
    expect(botSignal(bot({ strategy: "meanReversion" }), flat, 95)).toBe("long");
    expect(botSignal(bot({ strategy: "meanReversion" }), flat, 105)).toBe("short");
    expect(botSignal(bot({ strategy: "meanReversion" }), flat, 100.5)).toBeNull();
  });

  it("пробойный бот входит только за экстремумом окна", () => {
    expect(botSignal(bot({ strategy: "breakout" }), flat, 101)).toBe("long");
    expect(botSignal(bot({ strategy: "breakout" }), flat, 99)).toBe("short");
    expect(botSignal(bot({ strategy: "breakout" }), flat, 100)).toBeNull();
  });
});

describe("размер и защита позиции бота", () => {
  it("размер считается от риска: 1% баланса до стопа", () => {
    // баланс 10 000, риск 1% = 100 $, стоп 2% от цены 100 = 2 $ на единицу
    expect(botPositionSize(10_000, 100, bot({ riskPct: 1, stopPct: 2 }))).toBeCloseTo(50, 6);
  });

  it("нулевой стоп не приводит к делению на ноль", () => {
    expect(botPositionSize(10_000, 100, bot({ stopPct: 0 }))).toBe(0);
  });

  it("у бота всегда есть и стоп, и тейк, и они по разные стороны от входа", () => {
    const long = bot();
    expect(botStopLoss(100, "long", long)).toBeLessThan(100);
    expect(botTakeProfit(100, "long", long)).toBeGreaterThan(100);
    expect(botStopLoss(100, "short", long)).toBeGreaterThan(100);
    expect(botTakeProfit(100, "short", long)).toBeLessThan(100);
  });

  it("по умолчанию тейк дальше стопа — положительное соотношение риска", () => {
    const preset = defaultBot("A");
    expect(preset.takePct).toBeGreaterThan(preset.stopPct);
    expect(preset.stopPct).toBeGreaterThan(0);
  });
});

describe("ограничения ботов", () => {
  it("не открывает вторую позицию по тому же инструменту", () => {
    const open: Position = {
      id: "p",
      assetId: "A",
      side: "long",
      entryPrice: 100,
      size: 1,
      leverage: 1,
      openedAt: 0,
      fees: 0,
      style: "day",
    };
    expect(botHasPosition(bot(), [open])).toBe(true);
    expect(botHasPosition(bot(), [{ ...open, closedAt: 1 }])).toBe(false);
    expect(botHasPosition(bot({ assetId: "B" }), [open])).toBe(false);
  });

  it("слоты даются только перками ветки автоматики", () => {
    expect(botSlots([])).toBe(0);
    expect(botSlots(["PK_ALGO_DESK"])).toBe(1);
    expect(botSlots(["PK_ALGO_DESK", "PK_ALGO_FARM"])).toBe(2);
  });
});
