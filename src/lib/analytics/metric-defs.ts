import type { Metrics } from "./metrics";
import { fmtUsd, fmtPct, fmtRatio, fmtNum } from "../format";
import { translate, type Locale } from "../i18n/core";

// Numeric-only keys of Metrics (excludes arrays / breakdown objects).
type NumericMetricKey = {
  [K in keyof Metrics]: Metrics[K] extends number ? K : never;
}[keyof Metrics];

export type MetricFormat =
  | "usd"
  | "usdSigned"
  | "usdLoss"
  | "pct"
  | "pctPlain"
  | "ratio"
  | "rr"
  | "int"
  | "num2"
  | "days"
  | "duration";

export type MetricDef = {
  key: NumericMetricKey;
  label: string;
  format: MetricFormat;
};

export type MetricGroup = { key: string; title: string; items: MetricDef[] };

// The single source of truth for the list of metrics the app exposes.
// TOTAL_METRICS (below) is derived from this so the landing-page count is exact.
export const METRIC_GROUPS: MetricGroup[] = [
  {
    key: "returns",
    title: "Доходность",
    items: [
      { key: "totalNetPnl", label: "Чистый P&L", format: "usdSigned" },
      { key: "grossProfit", label: "Валовая прибыль", format: "usd" },
      { key: "grossLoss", label: "Валовый убыток", format: "usdLoss" },
      { key: "roiPct", label: "ROI", format: "pct" },
      { key: "annualizedReturnPct", label: "Годовая доходность", format: "pct" },
      { key: "finalEquity", label: "Итоговый капитал", format: "usd" },
      { key: "totalVolume", label: "Объём торгов", format: "usd" },
      { key: "avgTradePnl", label: "Средний P&L / сделку", format: "usdSigned" },
      { key: "avgDailyPnl", label: "Средний P&L / день", format: "usdSigned" },
      { key: "medianTrade", label: "Медианная сделка", format: "usdSigned" },
      { key: "bestTrade", label: "Лучшая сделка", format: "usdSigned" },
      { key: "worstTrade", label: "Худшая сделка", format: "usdSigned" },
    ],
  },
  {
    key: "efficiency",
    title: "Эффективность",
    items: [
      { key: "winRate", label: "Win Rate", format: "pctPlain" },
      { key: "lossRate", label: "Доля убыточных", format: "pctPlain" },
      { key: "profitFactor", label: "Profit Factor", format: "ratio" },
      { key: "payoffRatio", label: "Payoff Ratio", format: "ratio" },
      { key: "avgRR", label: "Средний RR", format: "rr" },
      { key: "expectancy", label: "Expectancy", format: "usdSigned" },
      { key: "avgReturnPct", label: "Средний возврат", format: "pct" },
      { key: "avgWin", label: "Средняя прибыль", format: "usd" },
      { key: "avgLoss", label: "Средний убыток", format: "usdLoss" },
      { key: "avgWinPct", label: "Средняя прибыль %", format: "pct" },
      { key: "avgLossPct", label: "Средний убыток %", format: "pct" },
      { key: "winLossRatio", label: "Побед / Поражений", format: "ratio" },
      { key: "kellyPct", label: "Kelly %", format: "pctPlain" },
      { key: "recoveryFactor", label: "Recovery Factor", format: "ratio" },
      { key: "stdDevTradePnl", label: "Ст. отклонение сделки", format: "usd" },
    ],
  },
  {
    key: "risk",
    title: "Риск",
    items: [
      { key: "maxDrawdown", label: "Макс. просадка", format: "usdLoss" },
      { key: "maxDrawdownPct", label: "Макс. просадка %", format: "pctPlain" },
      { key: "avgDrawdownPct", label: "Средняя просадка %", format: "pctPlain" },
      { key: "longestDrawdownDays", label: "Длит. просадки", format: "days" },
      { key: "sharpe", label: "Sharpe", format: "ratio" },
      { key: "sortino", label: "Sortino", format: "ratio" },
      { key: "calmar", label: "Calmar", format: "ratio" },
      { key: "volatilityPct", label: "Волатильность (год.)", format: "pctPlain" },
      { key: "downsideDevPct", label: "Downside deviation", format: "pctPlain" },
      { key: "ulcerIndex", label: "Ulcer Index", format: "ratio" },
    ],
  },
  {
    key: "trades",
    title: "Сделки",
    items: [
      { key: "tradeCount", label: "Всего сделок", format: "int" },
      { key: "wins", label: "Прибыльных", format: "int" },
      { key: "losses", label: "Убыточных", format: "int" },
      { key: "breakevens", label: "В ноль", format: "int" },
      { key: "longTrades", label: "Лонг сделок", format: "int" },
      { key: "shortTrades", label: "Шорт сделок", format: "int" },
      { key: "longWinRate", label: "Win Rate (лонг)", format: "pctPlain" },
      { key: "shortWinRate", label: "Win Rate (шорт)", format: "pctPlain" },
      { key: "longNetPnl", label: "P&L лонг", format: "usdSigned" },
      { key: "shortNetPnl", label: "P&L шорт", format: "usdSigned" },
      { key: "largestWinStreak", label: "Серия побед", format: "int" },
      { key: "largestLossStreak", label: "Серия поражений", format: "int" },
      { key: "symbolsTraded", label: "Инструментов", format: "int" },
    ],
  },
  {
    key: "activity",
    title: "Активность и время",
    items: [
      { key: "tradingDays", label: "Торговых дней", format: "int" },
      { key: "winningDays", label: "Прибыльных дней", format: "int" },
      { key: "losingDays", label: "Убыточных дней", format: "int" },
      { key: "percentWinningDays", label: "% прибыльных дней", format: "pctPlain" },
      { key: "bestDayPnl", label: "Лучший день", format: "usdSigned" },
      { key: "worstDayPnl", label: "Худший день", format: "usdSigned" },
      { key: "avgTradesPerDay", label: "Сделок в день", format: "num2" },
      { key: "avgDurationMs", label: "Среднее в позиции", format: "duration" },
      { key: "avgWinDurationMs", label: "Среднее (прибыль)", format: "duration" },
      { key: "avgLossDurationMs", label: "Среднее (убыток)", format: "duration" },
    ],
  },
  {
    key: "fees",
    title: "Комиссии",
    items: [
      { key: "totalFees", label: "Комиссии всего", format: "usdLoss" },
      { key: "avgFeePerTrade", label: "Комиссия / сделку", format: "usd" },
      { key: "feesToProfitPct", label: "Комиссии к прибыли", format: "pctPlain" },
    ],
  },
];

export const TOTAL_METRICS = METRIC_GROUPS.reduce(
  (n, g) => n + g.items.length,
  0,
);

export function formatMetric(
  value: number,
  format: MetricFormat,
  locale: Locale = "en",
): string {
  const u = (k: string) => translate(locale, k);
  switch (format) {
    case "usd":
      return fmtUsd(value);
    case "usdSigned":
      return fmtUsd(value, { sign: true });
    case "usdLoss":
      return fmtUsd(-Math.abs(value));
    case "pct":
      return fmtPct(value);
    case "pctPlain":
      return Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
    case "ratio":
      return fmtRatio(value);
    case "rr":
      return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}R` : "—";
    case "int":
      return fmtNum(value, 0);
    case "num2":
      return fmtNum(value, 2);
    case "days":
      return Number.isFinite(value) ? `${value.toFixed(1)} ${u("unit.day")}` : "—";
    case "duration": {
      const ms = value;
      if (!Number.isFinite(ms) || ms <= 0) return "—";
      const min = ms / 60000;
      if (min < 60) return `${Math.round(min)} ${u("unit.min")}`;
      const h = min / 60;
      if (h < 24) return `${h.toFixed(1)} ${u("unit.hour")}`;
      return `${(h / 24).toFixed(1)} ${u("unit.day")}`;
    }
    default:
      return String(value);
  }
}

// Tone for coloring a metric value.
export function metricTone(
  value: number,
  format: MetricFormat,
): "profit" | "loss" | "default" {
  if (format === "usdLoss") return value !== 0 ? "loss" : "default";
  if (format === "usdSigned" || format === "pct" || format === "rr") {
    if (value > 0) return "profit";
    if (value < 0) return "loss";
  }
  return "default";
}
