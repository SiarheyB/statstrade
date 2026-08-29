import { describe, it, expect } from "vitest";
import { appendOlderHistory, MAX_HISTORY_CANDLES } from "@/lib/chartHistory";

/** Свечи по возрастанию времени, как их держит буфер. */
const range = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => ({ t: from + i }));

describe("appendOlderHistory", () => {
  it("дописывает старый кусок ПЕРЕД буфером", () => {
    const buffer = range(100, 110);
    const older = range(90, 100);
    const out = appendOlderHistory(older, buffer, 1000);
    expect(out[0].t).toBe(90);
    expect(out[out.length - 1].t).toBe(109);
    expect(out).toHaveLength(20);
  });

  it("пустая догрузка не меняет буфер", () => {
    const buffer = range(100, 110);
    expect(appendOlderHistory([], buffer, 1000)).toBe(buffer);
  });

  it("работает на пустом буфере", () => {
    const out = appendOlderHistory(range(0, 5), [], 1000);
    expect(out.map((c) => c.t)).toEqual([0, 1, 2, 3, 4]);
  });

  // Главный случай, ради которого модуль и появился. Прежняя обрезка оставляла
  // ХВОСТ массива, то есть самые новые свечи, — а догруженные старые встают в
  // начало. Как только буфер набирал предел, каждая следующая догрузка
  // выбрасывалась тем же вызовом, который её принёс: график упирался в жёсткую
  // дату, хотя запросы продолжали уходить.
  it("при переполнении сохраняет ДОГРУЖЕННОЕ, а не выбрасывает его", () => {
    const buffer = range(1000, 1010); // 10 свечей, предел 12
    const older = range(990, 1000); // ещё 10 — суммарно 20
    const out = appendOlderHistory(older, buffer, 12);

    expect(out).toHaveLength(12);
    // Осталось самое старое: 990…1001. Догруженное на месте.
    expect(out[0].t).toBe(990);
    expect(out[out.length - 1].t).toBe(1001);
    // Ни одна из догруженных свечей не потерялась.
    for (const c of older) expect(out.some((x) => x.t === c.t)).toBe(true);
  });

  it("буфер не растёт сверх предела при многих догрузках подряд", () => {
    let buffer = range(1000, 1010);
    for (let start = 990; start >= 900; start -= 10) {
      buffer = appendOlderHistory(range(start, start + 10), buffer, 25);
      expect(buffer.length).toBeLessThanOrEqual(25);
    }
    // Левый край уехал вслед за прокруткой, а не застрял на исходном.
    expect(buffer[0].t).toBe(900);
  });

  it("время в буфере остаётся строго возрастающим", () => {
    let buffer = range(500, 510);
    for (let start = 490; start >= 460; start -= 10) {
      buffer = appendOlderHistory(range(start, start + 10), buffer, 100);
    }
    for (let i = 1; i < buffer.length; i++) {
      expect(buffer[i].t).toBeGreaterThan(buffer[i - 1].t);
    }
  });

  // 1h: живое окно 800 свечей + буфер. Прежние 4000 давали ровно 4800 часов =
  // 200 суток — та самая дата, дальше которой график не прокручивался.
  it("предел по умолчанию покрывает годы на часовом таймфрейме", () => {
    const hoursInWindow = 800 + MAX_HISTORY_CANDLES;
    expect(hoursInWindow / 24 / 365).toBeGreaterThan(2);
  });
});
