import { describe, it, expect } from "vitest";
import { orderTriggers, trailStop, triggerLevel, validateOrder } from "@/engine/player/pendingOrders";
import type { Order } from "@/engine/entities/types";

const order = (patch: Partial<Order>): Order => ({
  id: "o1",
  assetId: "A",
  type: "limit",
  side: "long",
  size: 1,
  createdAt: 0,
  status: "pending",
  ...patch,
});

describe("срабатывание отложенных ордеров", () => {
  it("лимит на покупку ждёт, пока цена опустится к уровню", () => {
    const o = order({ type: "limit", side: "long", limitPrice: 95 });
    expect(orderTriggers(o, 100)).toBe(false);
    expect(orderTriggers(o, 95)).toBe(true);
    expect(orderTriggers(o, 90)).toBe(true);
  });

  it("лимит на продажу ждёт, пока цена поднимется", () => {
    const o = order({ type: "limit", side: "short", limitPrice: 105 });
    expect(orderTriggers(o, 100)).toBe(false);
    expect(orderTriggers(o, 106)).toBe(true);
  });

  it("стоп на покупку — наоборот, ждёт пробоя вверх", () => {
    const o = order({ type: "stop", side: "long", stopPrice: 105 });
    expect(orderTriggers(o, 100)).toBe(false);
    expect(orderTriggers(o, 105)).toBe(true);
  });

  it("стоп и лимит на одном уровне трактуют одну цену противоположно", () => {
    const price = 99;
    const limitBuy = order({ type: "limit", side: "long", limitPrice: 100 });
    const stopBuy = order({ type: "stop", side: "long", stopPrice: 100 });
    expect(orderTriggers(limitBuy, price)).toBe(true);
    expect(orderTriggers(stopBuy, price)).toBe(false);
  });

  it("без уровня ордер не срабатывает никогда — иначе он открыл бы позицию по любой цене", () => {
    expect(orderTriggers(order({ type: "limit", limitPrice: undefined }), 100)).toBe(false);
    expect(triggerLevel(order({ type: "limit", limitPrice: undefined }))).toBeUndefined();
  });

  it("исполняемся по уровню ордера, а не по текущей цене", () => {
    expect(triggerLevel(order({ type: "limit", limitPrice: 95 }))).toBe(95);
    expect(triggerLevel(order({ type: "stop", stopPrice: 105 }))).toBe(105);
  });
});

describe("проверка стороны уровня", () => {
  it("лимит на покупку выше рынка отклоняется как опечатка", () => {
    expect(validateOrder("limit", "long", 105, 100)).toBe("wrong_side");
    expect(validateOrder("limit", "long", 95, 100)).toBe("ok");
  });

  it("стоп на покупку ниже рынка тоже бессмыслен", () => {
    expect(validateOrder("stop", "long", 95, 100)).toBe("wrong_side");
    expect(validateOrder("stop", "long", 105, 100)).toBe("ok");
  });

  it("у продажи всё зеркально", () => {
    expect(validateOrder("limit", "short", 105, 100)).toBe("ok");
    expect(validateOrder("limit", "short", 95, 100)).toBe("wrong_side");
    expect(validateOrder("stop", "short", 95, 100)).toBe("ok");
  });

  it("нулевой уровень не проходит", () => {
    expect(validateOrder("limit", "long", 0, 100)).toBe("wrong_side");
  });
});

describe("скользящий стоп", () => {
  it("ставится на заданном расстоянии, если стопа ещё не было", () => {
    expect(trailStop("long", 100, 2, undefined)).toBeCloseTo(98, 6);
    expect(trailStop("short", 100, 2, undefined)).toBeCloseTo(102, 6);
  });

  it("подтягивается за ценой в прибыль", () => {
    expect(trailStop("long", 110, 2, 98)).toBeCloseTo(107.8, 6);
  });

  it("не отступает назад на откате — иначе это уже не защита", () => {
    expect(trailStop("long", 105, 2, 107.8)).toBeUndefined();
    expect(trailStop("short", 95, 2, 92.2)).toBeUndefined();
  });

  it("шорт тянет стоп вниз", () => {
    expect(trailStop("short", 90, 2, 102)).toBeCloseTo(91.8, 6);
  });

  it("нулевой процент выключает трейлинг", () => {
    expect(trailStop("long", 100, 0, 95)).toBeUndefined();
  });
});
