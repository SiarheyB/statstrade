import { describe, it, expect } from "vitest";
import {
  METRIC_GROUPS,
  TOTAL_METRICS,
  formatMetric,
  metricTone,
} from "../analytics/metric-defs";

describe("metric-defs", () => {
  it("exposes metric groups with non-empty items", () => {
    expect(METRIC_GROUPS.length).toBeGreaterThan(0);
    for (const g of METRIC_GROUPS) {
      expect(g.key).toBeTruthy();
      expect(g.title).toBeTruthy();
      expect(Array.isArray(g.items)).toBe(true);
      expect(g.items.length).toBeGreaterThan(0);
      for (const item of g.items) {
        expect(item.key).toBeTruthy();
        expect(item.label).toBeTruthy();
        expect(item.format).toBeTruthy();
      }
    }
  });

  it("TOTAL_METRICS equals the sum of group item counts", () => {
    const sum = METRIC_GROUPS.reduce((n, g) => n + g.items.length, 0);
    expect(TOTAL_METRICS).toBe(sum);
    expect(TOTAL_METRICS).toBeGreaterThan(50);
  });

  it("every metric key is unique across groups", () => {
    const keys = METRIC_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  describe("formatMetric", () => {
    it("formats usd / usdSigned / usdLoss", () => {
      expect(formatMetric(1500, "usd")).toBe("1,500 $");
      expect(formatMetric(1500, "usdSigned")).toBe("+1,500 $");
      expect(formatMetric(-1500, "usdSigned")).toBe("-1,500 $");
      expect(formatMetric(-1500, "usdLoss")).toBe("-1,500 $");
    });

    it("formats pct / pctPlain", () => {
      expect(formatMetric(2.5, "pct")).toMatch(/2\.5/);
      expect(formatMetric(2.5, "pctPlain")).toBe("2.5%");
      expect(formatMetric(Number.NaN, "pctPlain")).toBe("—");
    });

    it("formats ratio / rr", () => {
      expect(formatMetric(2, "ratio")).toMatch(/2/);
      expect(formatMetric(3.5, "rr")).toBe("+3.50R");
      expect(formatMetric(-3.5, "rr")).toBe("-3.50R");
      expect(formatMetric(Number.NaN, "rr")).toBe("—");
    });

    it("formats int / num1 / num2", () => {
      expect(formatMetric(12, "int")).toBe("12");
      expect(formatMetric(1.23, "num1")).toBe("1.2");
      expect(formatMetric(1.234, "num2")).toBe("1.23");
    });

    it("formats pips", () => {
      expect(formatMetric(12.3, "pips")).toBe("+12.3");
      expect(formatMetric(-12.3, "pips")).toBe("-12.3");
      expect(formatMetric(Number.NaN, "pips")).toBe("—");
    });

    it("formats days", () => {
      expect(formatMetric(2.5, "days")).toBe("2.5 d");
      expect(formatMetric(Number.NaN, "days")).toBe("—");
    });

    it("formats duration (ms → human)", () => {
      expect(formatMetric(0, "duration")).toBe("—");
      expect(formatMetric(Number.NaN, "duration")).toBe("—");
      expect(formatMetric(30 * 60000, "duration")).toBe("30 min");
      expect(formatMetric(90 * 60000, "duration")).toBe("1.5 h");
      expect(formatMetric(2 * 24 * 60 * 60000, "duration")).toBe("2.0 d");
    });

    it("returns the value as string for unknown formats", () => {
      expect(formatMetric(5, "unknown" as never)).toBe("5");
    });
  });

  describe("metricTone", () => {
    it("marks usdLoss as loss when non-zero, default when zero", () => {
      expect(metricTone(-10, "usdLoss")).toBe("loss");
      expect(metricTone(0, "usdLoss")).toBe("default");
    });

    it("marks signed/pct/rr by sign", () => {
      expect(metricTone(5, "usdSigned")).toBe("profit");
      expect(metricTone(-5, "usdSigned")).toBe("loss");
      expect(metricTone(0, "usdSigned")).toBe("default");
      expect(metricTone(5, "pct")).toBe("profit");
      expect(metricTone(-5, "pct")).toBe("loss");
      expect(metricTone(5, "rr")).toBe("profit");
      expect(metricTone(-5, "rr")).toBe("loss");
    });

    it("returns default for neutral formats", () => {
      expect(metricTone(5, "int")).toBe("default");
      expect(metricTone(-5, "ratio")).toBe("default");
    });
  });
});
