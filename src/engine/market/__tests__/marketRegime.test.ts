import { describe, it, expect } from "vitest";
import {
  makeRegime,
  pickNextRegime,
  REGIME_PRESETS,
  REGIME_TRANSITIONS,
  switchProbabilityPerDay,
  updateMarketRegime,
} from "@/engine/market/marketRegime";
import { mulberry32 } from "@/engine/rng";
import type { MarketRegimeType } from "@/engine/entities/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("пресеты режимов", () => {
  it("бычий рынок растит снос, кризис его переворачивает и раздувает волатильность", () => {
    expect(REGIME_PRESETS.bull.driftModifier).toBeGreaterThan(1);
    expect(REGIME_PRESETS.crisis.driftModifier).toBeLessThan(0);
    expect(REGIME_PRESETS.crisis.volModifier).toBeGreaterThan(REGIME_PRESETS.sideways.volModifier);
  });

  it("у каждого режима конечная длительность — иначе рынок застрял бы навсегда", () => {
    for (const preset of Object.values(REGIME_PRESETS)) {
      expect(Number.isFinite(preset.maxDurationDays)).toBe(true);
      expect(preset.maxDurationDays).toBeGreaterThan(preset.minDurationDays);
    }
  });

  it("из каждого режима есть куда перейти, и никогда — в себя же", () => {
    for (const [from, options] of Object.entries(REGIME_TRANSITIONS) as [MarketRegimeType, [MarketRegimeType, number][]][]) {
      expect(options.length).toBeGreaterThan(0);
      for (const [to] of options) expect(to).not.toBe(from);
    }
  });
});

describe("switchProbabilityPerDay", () => {
  it("до минимального срока режим не меняется вовсе", () => {
    // Берём срок из пресета, а не число: длительности режимов перебалансированы
    // под реальное время и ещё будут меняться.
    expect(switchProbabilityPerDay(makeRegime("bull", REGIME_PRESETS.bull.minDurationDays - 0.5))).toBe(0);
  });

  it("на максимальном сроке смена гарантирована", () => {
    expect(switchProbabilityPerDay(makeRegime("bull", REGIME_PRESETS.bull.maxDurationDays))).toBe(1);
  });

  it("между минимумом и максимумом вероятность растёт", () => {
    const early = switchProbabilityPerDay(makeRegime("bear", REGIME_PRESETS.bear.minDurationDays + 0.5));
    const late = switchProbabilityPerDay(makeRegime("bear", REGIME_PRESETS.bear.maxDurationDays - 1));
    expect(late).toBeGreaterThan(early);
    expect(early).toBeGreaterThan(0);
  });
});

describe("updateMarketRegime", () => {
  it("копит прожитые дни", () => {
    const next = updateMarketRegime(makeRegime("sideways"), 2 * MS_PER_DAY, mulberry32(1));
    expect(next.type).toBe("sideways");
    expect(next.daysInRegime).toBeCloseTo(2, 10);
  });

  it("не меняет режим раньше минимального срока ни при каком броске", () => {
    // rng = 0 — самый «удачный» бросок для смены; до minDuration он не должен
    // ничего менять вообще.
    const young = Math.max(0, REGIME_PRESETS.bull.minDurationDays - 2);
    const next = updateMarketRegime(makeRegime("bull", young), MS_PER_DAY / 4, () => 0);
    expect(next.type).toBe("bull");
  });

  it("на максимальном сроке меняет режим и обнуляет счётчик дней", () => {
    const expired = makeRegime("crisis", REGIME_PRESETS.crisis.maxDurationDays);
    const next = updateMarketRegime(expired, MS_PER_DAY, mulberry32(7));
    expect(next.type).not.toBe("crisis");
    expect(next.daysInRegime).toBe(0);
    // и вместе с типом подтянулись пресеты нового режима
    expect(next.volModifier).toBe(REGIME_PRESETS[next.type].volModifier);
  });

  it("длинный шаг (офлайн-прогресс перескакивает сутки) не меняет режим по нескольку раз", () => {
    const next = updateMarketRegime(makeRegime("bull", 100), 3 * MS_PER_DAY, mulberry32(3));
    expect(next.daysInRegime === 0 || next.type === "bull").toBe(true);
  });

  it("нулевой интервал ничего не делает", () => {
    const regime = makeRegime("bear", 50);
    expect(updateMarketRegime(regime, 0, mulberry32(1))).toBe(regime);
  });
});

describe("pickNextRegime", () => {
  it("возвращает режим из таблицы переходов при любом броске", () => {
    for (const from of Object.keys(REGIME_TRANSITIONS) as MarketRegimeType[]) {
      for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
        const next = pickNextRegime(from, () => roll);
        expect(REGIME_TRANSITIONS[from].map(([t]) => t)).toContain(next);
      }
    }
  });
});
