import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fmtMoney,
  fmtPct,
  fmtRatio,
  fmtNum,
  fmtPrice,
  fmtDuration,
  fmtDate,
  fmtSymbol,
  canonSymbol,
  pnlColor,
  setFormatLocale,
} from "@/lib/format";

vi.mock("@/lib/timezone", () => ({
  ianaFor: () => "UTC",
  timeZoneFromCookie: () => null,
}));

describe("format helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Используем en-US в тестах для стабильного вывода (точки, пробелы).
    // Русская локаль в проде включается через I18nProvider.
    setFormatLocale("en");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    setFormatLocale("en");
  });

  // -------------------------------------------------------------------------
  // 1. Money formatting
  // -------------------------------------------------------------------------
  describe("fmtMoney", () => {
    it("formats positive numbers with + sign and no decimals for >= 1000", () => {
      expect(fmtMoney(1234.567, { sign: true })).toBe("+1,235");
    });

    it("formats negative numbers with 2 decimals", () => {
      expect(fmtMoney(-500)).toBe("-500.00");
    });

    it("handles zero and non-finite values", () => {
      expect(fmtMoney(0)).toBe("0.00");
      expect(fmtMoney(NaN as any)).toBe("—");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Percentage and ratio formatting
  //    Вход — уже проценты (как в проде: returnPct, mfePct, (p5-1)*100).
  // -------------------------------------------------------------------------
  describe("fmtPct & fmtRatio", () => {
    it("formats percentages with '+' sign for positive", () => {
      expect(fmtPct(0.5)).toBe("+0.5%");
      expect(fmtPct(-1)).toBe("-1.0%");
    });

    it("respects digit precision", () => {
      expect(fmtPct(12.3456, 3)).toBe("+12.346%");
    });

    it("fmtRatio shows raw value", () => {
      expect(fmtRatio(1.23)).toBe("1.23");
      expect(fmtRatio(Infinity)).toBe("∞");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Number and price formatting
  // -------------------------------------------------------------------------
  describe("fmtNum & fmtPrice", () => {
    it("formats small numbers with appropriate precision", () => {
      expect(fmtNum(0.00123, 2)).toBe("0.00");
      expect(fmtNum(0.00123)).toBe("0.00");
    });

    it("formats large numbers with grouped digits", () => {
      expect(fmtPrice(1234567)).toBe("1,234,567");
    });

    it("formats zero and non-finite values", () => {
      expect(fmtPrice(0)).toBe("0.00");
      expect(fmtPrice(NaN as any)).toBe("—");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Duration formatting
  // -------------------------------------------------------------------------
  describe("fmtDuration", () => {
    it("formats 1 minute", () => {
      expect(fmtDuration(60000)).toBe("1 min");
    });

    it("formats hours as '1.5 h'", () => {
      expect(fmtDuration(5400000)).toBe("1.5 h");
    });

    it("formats days", () => {
      expect(fmtDuration(3 * 24 * 3600000)).toBe("3 d");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Date and symbol formatting
  // -------------------------------------------------------------------------
  describe("fmtDate & symbol formatters", () => {
    it("formats dates according to locale/timezone (date only)", () => {
      const ts = new Date("2024-01-15T12:30:45.123Z").getTime();
      const opts = { day: "2-digit", month: "2-digit", year: "numeric" } as const;
      expect(fmtDate(ts)).toBe(new Date(ts).toLocaleDateString("en-US", opts));
      expect(fmtDate("2024-01-15T12:30:45.123Z")).toBe(
        new Date("2024-01-15T12:30:45.123Z").toLocaleDateString("en-US", opts)
      );
    });

    it("normalizes exchange symbols", () => {
      expect(fmtSymbol("BTC/USDT")).toBe("BTCUSDT");
      expect(canonSymbol("ETH/USDT:USDT")).toBe("ETHUSDT");
    });
  });

  it("returns correct pnl color based on sign", () => {
    expect(pnlColor(10)).toBe("text-profit");
    expect(pnlColor(-5)).toBe("text-loss");
    expect(pnlColor(0)).toBe("text-muted");
  });
});
