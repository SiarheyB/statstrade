import { describe, it, expect } from "vitest";
import { formatMetric, metricTone, TOTAL_METRICS, METRIC_GROUPS } from "../metric-defs";

describe("formatMetric", () => {
  it("formats 'usd' without sign", () => {
    expect(formatMetric(1234.56, "usd")).toBe("1,235 $");
    expect(formatMetric(-1234.56, "usd")).toBe("-1,235 $");
  });

  it("formats 'usdSigned' with + sign for positive", () => {
    expect(formatMetric(1234.56, "usdSigned")).toBe("+1,235 $");
    expect(formatMetric(-50, "usdSigned")).toBe("-50 $");
  });

  it("formats 'usdLoss' always negative", () => {
    expect(formatMetric(100, "usdLoss")).toBe("-100 $");
    expect(formatMetric(-100, "usdLoss")).toBe("-100 $");
  });

  it("formats 'pct' with sign and %", () => {
    expect(formatMetric(12.34, "pct")).toBe("+12.3%");
    expect(formatMetric(-5.6, "pct")).toBe("-5.6%");
  });

  it("formats 'pctPlain' without sign", () => {
    expect(formatMetric(12.34, "pctPlain")).toBe("12.3%");
    expect(formatMetric(-5.6, "pctPlain")).toBe("-5.6%");
  });

  it("formats 'ratio' via fmtRatio", () => {
    expect(formatMetric(2.5, "ratio")).toBe("2.50");
    expect(formatMetric(Infinity, "ratio")).toBe("∞");
  });

  it("formats 'rr' with R suffix", () => {
    expect(formatMetric(2.5, "rr")).toBe("+2.50R");
    expect(formatMetric(-1.5, "rr")).toBe("-1.50R");
    expect(formatMetric(Infinity, "rr")).toBe("—");
  });

  it("formats 'int' as integer", () => {
    expect(formatMetric(1234.56, "int")).toBe("1,235");
    expect(formatMetric(-5, "int")).toBe("-5");
  });

  it("formats 'num1'/'num2' with decimals", () => {
    expect(formatMetric(1.234, "num1")).toBe("1.2");
    expect(formatMetric(1.234, "num2")).toBe("1.23");
  });

  it("formats 'pips'", () => {
    expect(formatMetric(12.3, "pips")).toBe("+12.3");
    expect(formatMetric(-5, "pips")).toBe("-5.0");
  });

  it("formats 'days' with unit", () => {
    const out = formatMetric(3.5, "days");
    expect(out).toContain("3.5");
  });

  it("formats 'duration' via fmtDuration", () => {
    expect(formatMetric(90000, "duration")).toBeTruthy();
  });
});

describe("metricTone", () => {
  it("returns 'loss' for usdLoss with nonzero value", () => {
    expect(metricTone(-50, "usdLoss")).toBe("loss");
    expect(metricTone(0, "usdLoss")).toBe("default");
  });

  it("classifies signed formats by sign", () => {
    expect(metricTone(10, "usdSigned")).toBe("profit");
    expect(metricTone(-10, "usdSigned")).toBe("loss");
    expect(metricTone(10, "pct")).toBe("profit");
    expect(metricTone(-10, "pct")).toBe("loss");
    expect(metricTone(10, "rr")).toBe("profit");
    expect(metricTone(-10, "rr")).toBe("loss");
  });

  it("returns 'default' for neutral/non-signed formats", () => {
    expect(metricTone(10, "usd")).toBe("default");
    expect(metricTone(10, "int")).toBe("default");
    expect(metricTone(-10, "pctPlain")).toBe("default");
  });
});

describe("METRIC_GROUPS / TOTAL_METRICS", () => {
  it("TOTAL_METRICS equals sum of group item counts", () => {
    const sum = METRIC_GROUPS.reduce((n, g) => n + g.items.length, 0);
    expect(TOTAL_METRICS).toBe(sum);
    expect(sum).toBeGreaterThan(0);
  });

  it("all metric keys are unique", () => {
    const keys = METRIC_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every metric has a known format", () => {
    const formats = ["usd", "usdSigned", "usdLoss", "pct", "pctPlain", "ratio", "rr", "int", "num1", "num2", "pips", "days", "duration"];
    for (const g of METRIC_GROUPS) {
      for (const item of g.items) {
        expect(formats).toContain(item.format);
      }
    }
  });
});
