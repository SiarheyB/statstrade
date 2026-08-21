import { describe, it, expect, vi } from "vitest";
import { createFallbackController, isMarketClosed } from "../fallback.mjs";

// Переключение источника — самая рискованная часть коллектора: ошибка здесь
// либо оставляет данные несобранными, либо держит лишнее WS-соединение.

const make = (failCycles = 3) => {
  const onEnable = vi.fn();
  const onDisable = vi.fn();
  const ctl = createFallbackController({ failCycles, onEnable, onDisable });
  return { ctl, onEnable, onDisable };
};

const fail = (ctl, times, opts = {}) => {
  for (let i = 0; i < times; i++) ctl.recordCycle({ attempts: 4, failures: 4, ...opts });
};

describe("createFallbackController", () => {
  it("молчит, пока сбоев меньше порога", () => {
    const { ctl, onEnable } = make(3);
    fail(ctl, 2);
    expect(ctl.active).toBe(false);
    expect(onEnable).not.toHaveBeenCalled();
  });

  it("поднимает резерв на пороге и ровно один раз", () => {
    const { ctl, onEnable } = make(3);
    fail(ctl, 5);
    expect(ctl.active).toBe(true);
    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it("возвращается к основному источнику после успешного цикла", () => {
    const { ctl, onDisable } = make(2);
    fail(ctl, 2);
    expect(ctl.active).toBe(true);
    ctl.recordCycle({ attempts: 4, failures: 0 });
    expect(ctl.active).toBe(false);
    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  it("не переключается из-за единичной ошибки в цикле", () => {
    // Один 503 по одному инструменту — обычное дело для недокументированного
    // эндпоинта, менять из-за него источник нельзя.
    const { ctl } = make(2);
    for (let i = 0; i < 10; i++) ctl.recordCycle({ attempts: 4, failures: 1 });
    expect(ctl.active).toBe(false);
    expect(ctl.failStreak).toBe(0);
  });

  it("частичный сбой не сбрасывает и не наращивает счётчик", () => {
    const { ctl } = make(3);
    fail(ctl, 2);
    ctl.recordCycle({ attempts: 4, failures: 2 }); // ни всё, ни ничего
    expect(ctl.failStreak).toBe(2);
    expect(ctl.active).toBe(false);
  });

  it("на закрытом рынке счётчик не двигается", () => {
    // Выходные: живых данных нет ни у кого, поднимать резерв бессмысленно.
    const { ctl, onEnable } = make(2);
    fail(ctl, 10, { marketClosed: true });
    expect(ctl.failStreak).toBe(0);
    expect(onEnable).not.toHaveBeenCalled();
  });

  it("пустой цикл (нечего опрашивать) ничего не меняет", () => {
    const { ctl } = make(1);
    ctl.recordCycle({ attempts: 0, failures: 0 });
    expect(ctl.active).toBe(false);
  });

  it("reset возвращает к основному источнику и зовёт onDisable", () => {
    const { ctl, onDisable } = make(1);
    fail(ctl, 1);
    expect(ctl.active).toBe(true);
    ctl.reset();
    expect(ctl.active).toBe(false);
    expect(ctl.failStreak).toBe(0);
    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  it("не дёргает колбэки повторно, пока состояние не менялось", () => {
    const { ctl, onEnable, onDisable } = make(1);
    fail(ctl, 5);
    expect(onEnable).toHaveBeenCalledTimes(1);
    expect(onDisable).not.toHaveBeenCalled();
  });
});

describe("isMarketClosed", () => {
  const at = (iso) => Date.parse(iso);

  it("будни — рынок открыт", () => {
    expect(isMarketClosed(at("2026-08-17T09:00:00Z"))).toBe(false);
    expect(isMarketClosed(at("2026-08-21T20:59:00Z"))).toBe(false);
  });

  it("с вечера пятницы до вечера воскресенья — закрыт", () => {
    expect(isMarketClosed(at("2026-08-21T21:00:00Z"))).toBe(true);
    expect(isMarketClosed(at("2026-08-22T12:00:00Z"))).toBe(true);
    expect(isMarketClosed(at("2026-08-23T21:59:00Z"))).toBe(true);
    expect(isMarketClosed(at("2026-08-23T22:00:00Z"))).toBe(false);
  });
});
