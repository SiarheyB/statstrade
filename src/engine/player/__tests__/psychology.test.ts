import { describe, it, expect } from "vitest";
import {
  applySlippage,
  applyTradeOutcome,
  CALM_THRESHOLD,
  freshPsychology,
  MAX_SLIPPAGE,
  MAX_STRESS,
  recoverOverTime,
  stressLevel,
  stressSlippage,
} from "@/engine/player/psychology";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const win = { pnl: 100, hadStop: true, leverage: 1, liquidated: false };
const loss = { pnl: -100, hadStop: false, leverage: 1, liquidated: false };

describe("applyTradeOutcome", () => {
  it("одиночный убыток почти не давит, серия — давит", () => {
    let psych = freshPsychology();
    psych = applyTradeOutcome(psych, loss);
    const afterOne = psych.stress;
    for (let i = 0; i < 3; i++) psych = applyTradeOutcome(psych, loss);
    expect(psych.stress).toBeGreaterThan(afterOne * 3);
    expect(psych.consecutiveLosses).toBe(4);
  });

  it("прибыль успокаивает и обнуляет серию убытков", () => {
    let psych = applyTradeOutcome(freshPsychology(), loss);
    psych = applyTradeOutcome(psych, loss);
    const stressed = psych.stress;
    psych = applyTradeOutcome(psych, win);
    expect(psych.stress).toBeLessThan(stressed);
    expect(psych.consecutiveLosses).toBe(0);
    expect(psych.consecutiveWins).toBe(1);
  });

  it("крупное плечо и ликвидация добавляют стресса", () => {
    const plain = applyTradeOutcome(freshPsychology(), loss);
    const levered = applyTradeOutcome(freshPsychology(), { ...loss, leverage: 10 });
    const liquidated = applyTradeOutcome(freshPsychology(), { ...loss, liquidated: true });
    expect(levered.stress).toBeGreaterThan(plain.stress);
    expect(liquidated.stress).toBeGreaterThan(plain.stress);
  });

  it("убыток по заранее выставленному стопу переносится легче, чем без него", () => {
    const withStop = applyTradeOutcome(freshPsychology(), { ...loss, hadStop: true });
    const without = applyTradeOutcome(freshPsychology(), loss);
    expect(withStop.stress).toBeLessThan(without.stress);
    expect(withStop.discipline).toBeGreaterThan(without.discipline);
  });

  it("стресс не выходит за границы шкалы", () => {
    let psych = freshPsychology();
    for (let i = 0; i < 100; i++) psych = applyTradeOutcome(psych, { ...loss, leverage: 10, liquidated: true });
    expect(psych.stress).toBeLessThanOrEqual(MAX_STRESS);
    let calm = freshPsychology();
    for (let i = 0; i < 100; i++) calm = applyTradeOutcome(calm, win);
    expect(calm.stress).toBeGreaterThanOrEqual(0);
  });
});

describe("recoverOverTime", () => {
  it("стресс сходит со временем", () => {
    const stressed = { ...freshPsychology(), stress: 60 };
    expect(recoverOverTime(stressed, MS_PER_DAY).stress).toBeLessThan(60);
  });

  it("купленный отдых ускоряет восстановление", () => {
    const stressed = { ...freshPsychology(), stress: 60 };
    const plain = recoverOverTime(stressed, MS_PER_DAY, 1).stress;
    const rested = recoverOverTime(stressed, MS_PER_DAY, 1.5).stress;
    expect(rested).toBeLessThan(plain);
  });

  it("не уводит стресс ниже нуля и не трогает спокойного", () => {
    const calm = freshPsychology();
    expect(recoverOverTime(calm, 10 * MS_PER_DAY)).toBe(calm);
    expect(recoverOverTime({ ...calm, stress: 1 }, 10 * MS_PER_DAY).stress).toBe(0);
  });

  it("уверенность сползает к нейтральной, а не растёт бесконечно", () => {
    const euphoric = { ...freshPsychology(), confidence: 95 };
    const depressed = { ...freshPsychology(), confidence: 5 };
    expect(recoverOverTime(euphoric, MS_PER_DAY).confidence).toBeLessThan(95);
    expect(recoverOverTime(depressed, MS_PER_DAY).confidence).toBeGreaterThan(5);
  });
});

describe("проскальзывание от стресса", () => {
  it("спокойный трейдер исполняется идеально", () => {
    expect(stressSlippage(0)).toBe(0);
    expect(stressSlippage(CALM_THRESHOLD)).toBe(0);
    expect(applySlippage(100, "long", true, CALM_THRESHOLD)).toBe(100);
  });

  it("растёт со стрессом и ограничено сверху", () => {
    expect(stressSlippage(80)).toBeGreaterThan(stressSlippage(60));
    expect(stressSlippage(MAX_STRESS)).toBeCloseTo(MAX_SLIPPAGE, 10);
  });

  it("всегда НЕ в пользу игрока — и на входе, и на выходе", () => {
    const stress = MAX_STRESS;
    expect(applySlippage(100, "long", true, stress)).toBeGreaterThan(100); // покупаем дороже
    expect(applySlippage(100, "long", false, stress)).toBeLessThan(100); // продаём дешевле
    expect(applySlippage(100, "short", true, stress)).toBeLessThan(100); // шортим ниже
    expect(applySlippage(100, "short", false, stress)).toBeGreaterThan(100); // закрываем выше
  });

  it("уровень стресса читается тремя состояниями", () => {
    expect(stressLevel(10)).toBe("calm");
    expect(stressLevel(55)).toBe("tense");
    expect(stressLevel(90)).toBe("high");
  });
});
