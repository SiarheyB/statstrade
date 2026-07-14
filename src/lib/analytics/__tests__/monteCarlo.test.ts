import { describe, it, expect } from "vitest";
import { runMonteCarlo, type MonteCarloResult } from "../monteCarlo";

describe("runMonteCarlo", () => {
  it("returns null for empty returns array", () => {
    expect(runMonteCarlo([], { simulations: 100, projectedTrades: 10, ruinDrawdownPct: 50 })).toBeNull();
  });

  it("runs basic simulation with positive returns", () => {
    const returns = [0.1, 0.05, -0.02, 0.15, -0.08]; // +10%, +5%, -2%, +15%, -8%
    const result = runMonteCarlo(returns, { simulations: 1000, projectedTrades: 50, ruinDrawdownPct: 20 });

    expect(result).not.toBeNull();
    expect(result!.simulations).toBe(1000);
    expect(result!.projectedTrades).toBe(50);
    expect(result!.riskOfRuinPct).toBeGreaterThanOrEqual(0);
    expect(result!.riskOfRuinPct).toBeLessThanOrEqual(100);
    expect(result!.p5).toBeGreaterThan(0);
    expect(result!.p50).toBeGreaterThan(result!.p5);
    expect(result!.p95).toBeGreaterThan(result!.p50);
    expect(result!.sampleCurves.min.length).toBe(51); // steps + 1
    expect(result!.sampleCurves.median.length).toBe(51);
    expect(result!.sampleCurves.max.length).toBe(51);
  });

  it("handles all winning trades", () => {
    const returns = [0.1, 0.05, 0.02]; // all positive
    const result = runMonteCarlo(returns, { simulations: 500, projectedTrades: 30, ruinDrawdownPct: 50 });

    expect(result).not.toBeNull();
    expect(result!.riskOfRuinPct).toBe(0); // no ruin possible with only wins
    expect(result!.p5).toBeGreaterThan(1);
    expect(result!.p50).toBeGreaterThan(result!.p5);
    expect(result!.p95).toBeGreaterThan(result!.p50);
  });

  it("handles all losing trades", () => {
    const returns = [-0.1, -0.05, -0.02]; // all negative
    const result = runMonteCarlo(returns, { simulations: 500, projectedTrades: 30, ruinDrawdownPct: 50 });

    expect(result).not.toBeNull();
    expect(result!.riskOfRuinPct).toBe(100); // ruin guaranteed with losses only
    expect(result!.p5).toBeLessThan(1);
    expect(result!.p50).toBeGreaterThan(result!.p5);
    expect(result!.p95).toBeLessThan(1);
  });

  it("uses provided seed for deterministic results", () => {
    // Note: makeRng uses fixed seed 0x9e3779b9 in the function, so we can't test different seeds
    // but we can verify it produces consistent results
    const returns = [0.1, -0.05, 0.03];
    const result1 = runMonteCarlo(returns, { simulations: 100, projectedTrades: 20, ruinDrawdownPct: 30 });
    const result2 = runMonteCarlo(returns, { simulations: 100, projectedTrades: 20, ruinDrawdownPct: 30 });

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1!.riskOfRuinPct).toBe(result2!.riskOfRuinPct);
    expect(result1!.p50).toBeCloseTo(result2!.p50, 4);
  });

  it("handles zero returns", () => {
    const returns = [0, 0, 0];
    const result = runMonteCarlo(returns, { simulations: 200, projectedTrades: 10, ruinDrawdownPct: 10 });

    expect(result).not.toBeNull();
    expect(result!.riskOfRuinPct).toBe(0); // no drawdown possible
    expect(result!.p5).toBeCloseTo(1, 4);
    expect(result!.p50).toBeCloseTo(1, 4);
    expect(result!.p95).toBeCloseTo(1, 4);
  });

  it("respects ruinDrawdownPct parameter", () => {
    const returns = [0.2, -0.3, 0.1, -0.25, 0.05];
    const resultLow = runMonteCarlo(returns, { simulations: 500, projectedTrades: 20, ruinDrawdownPct: 10 });
    const resultHigh = runMonteCarlo(returns, { simulations: 500, projectedTrades: 20, ruinDrawdownPct: 50 });

    expect(resultLow).not.toBeNull();
    expect(resultHigh).not.toBeNull();
    // Higher ruin threshold should give equal or lower risk
    expect(resultHigh!.riskOfRuinPct).toBeLessThanOrEqual(resultLow!.riskOfRuinPct);
  });

  it("sampleCurves contain min/median/max curves", () => {
    const returns = [0.1, -0.05, 0.03, -0.02, 0.04];
    const result = runMonteCarlo(returns, { simulations: 100, projectedTrades: 30, ruinDrawdownPct: 25 });

    expect(result).not.toBeNull();
    const { min, median, max } = result!.sampleCurves;
    expect(min.length).toBe(31);
    expect(median.length).toBe(31);
    expect(max.length).toBe(31);
    // min/median/max curves are selected by final equity (worst/median/best outcome),
    // not pointwise percentiles, so only starting point and final ordering are guaranteed
    const last = min.length - 1;
    expect(min[0]).toBeCloseTo(1, 10);
    expect(median[0]).toBeCloseTo(1, 10);
    expect(max[0]).toBeCloseTo(1, 10);
    expect(min[last]).toBeLessThanOrEqual(median[last] + 0.001);
    expect(median[last]).toBeLessThanOrEqual(max[last] + 0.001);
  });

  it("handles large number of simulations", () => {
    const returns = [0.05, -0.03];
    const result = runMonteCarlo(returns, { simulations: 10000, projectedTrades: 100, ruinDrawdownPct: 15 });

    expect(result).not.toBeNull();
    expect(result!.simulations).toBe(10000);
    expect(result!.projectedTrades).toBe(100);
    expect(result!.riskOfRuinPct).toBeGreaterThanOrEqual(0);
    expect(result!.riskOfRuinPct).toBeLessThanOrEqual(100);
  });
});