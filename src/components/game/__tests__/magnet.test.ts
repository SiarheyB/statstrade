import { describe, it, expect } from "vitest";
import { snapToBar } from "@/components/game/PriceChart";

// Свеча с телом 100–104 и тенями до 96 и 108: высота 12, порог притяжения —
// треть от неё, 4.2.
const bars = [
  { t: 0, o: 100, h: 108, l: 96, c: 104 },
  { t: 60_000, o: 104, h: 110, l: 103, c: 109 },
];

describe("магнит разметки", () => {
  it("выключенный не трогает точку вовсе", () => {
    expect(snapToBar(bars, 0.3, 101.234, false)).toEqual({ slot: 0.3, price: 101.234 });
  });

  it("притягивает к хаю, если целились в верх свечи", () => {
    expect(snapToBar(bars, 0.1, 106, true)).toEqual({ slot: 0, price: 108 });
  });

  it("притягивает к лою, если целились в низ", () => {
    expect(snapToBar(bars, 0.1, 98, true)).toEqual({ slot: 0, price: 96 });
  });

  it("в середине свечи цену не меняет — только выравнивает по бару", () => {
    // Середина от обоих краёв дальше порога: человек ставил уровень не по
    // экстремуму, и подтягивать его к хаю было бы враньём.
    expect(snapToBar(bars, 0.1, 102, true)).toEqual({ slot: 0, price: 102 });
  });

  it("берёт ближний край, когда до обоих близко", () => {
    const flat = [{ t: 0, o: 100, h: 101, l: 100, c: 100.5 }];
    expect(snapToBar(flat, 0, 100.8, true).price).toBe(101);
    expect(snapToBar(flat, 0, 100.2, true).price).toBe(100);
  });

  it("ищет ближайшую свечу по слоту", () => {
    expect(snapToBar(bars, 0.9, 109.5, true)).toEqual({ slot: 1, price: 110 });
  });

  it("не притягивает точку, поставленную далеко за краем ряда", () => {
    // Правее последней свечи (пустое поле справа) магнит молчит: тянуть
    // уровень назад к последнему бару человек не просил.
    expect(snapToBar(bars, 5, 107, true)).toEqual({ slot: 5, price: 107 });
  });

  it("не делит на ноль на свече без диапазона", () => {
    const doji = [{ t: 0, o: 100, h: 100, l: 100, c: 100 }];
    const snapped = snapToBar(doji, 0, 100.05, true);
    expect(Number.isFinite(snapped.price)).toBe(true);
  });

  it("пустой ряд оставляет точку как есть", () => {
    expect(snapToBar([], 3, 50, true)).toEqual({ slot: 3, price: 50 });
  });
});
