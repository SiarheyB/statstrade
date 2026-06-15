// Formatting helpers shared across client components.
// The active locale is set by the I18nProvider via setFormatLocale().

let LOCALE: "en" | "ru" = "en";

export function setFormatLocale(l: "en" | "ru") {
  LOCALE = l;
}

function numLocale(): string {
  return LOCALE === "ru" ? "ru-RU" : "en-US";
}

export function fmtMoney(value: number, opts: { sign?: boolean } = {}): string {
  if (!Number.isFinite(value)) return "—";
  const sign = opts.sign && value > 0 ? "+" : "";
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : 2;
  return (
    sign +
    value.toLocaleString(numLocale(), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  );
}

export function fmtUsd(value: number, opts: { sign?: boolean } = {}): string {
  if (!Number.isFinite(value)) return "—";
  return fmtMoney(value, opts) + " $";
}

export function fmtPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function fmtRatio(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "∞";
  return value.toFixed(digits);
}

export function fmtNum(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(numLocale(), { maximumFractionDigits: digits });
}

export function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1000) return value.toLocaleString(numLocale(), { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(2);
  return value.toPrecision(4);
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const ru = LOCALE === "ru";
  const min = ms / 60000;
  if (min < 60) return `${Math.round(min)} ${ru ? "мин" : "min"}`;
  const hours = min / 60;
  if (hours < 24) return `${hours.toFixed(1)} ${ru ? "ч" : "h"}`;
  const days = hours / 24;
  return `${days.toFixed(1)} ${ru ? "дн" : "d"}`;
}

export function fmtDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString(numLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function pnlColor(value: number): string {
  if (value > 0) return "text-profit";
  if (value < 0) return "text-loss";
  return "text-muted";
}
