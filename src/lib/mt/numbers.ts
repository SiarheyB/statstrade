// Locale-tolerant parsing of the numbers and dates MetaTrader reports contain.

// "1 234.56", "1,234.56", "1234,56", "-50.00", "" → number (0 when blank/invalid).
export function parseNum(raw: string | undefined | null): number {
  if (raw == null) return 0;
  let s = raw.replace(/ /g, "").replace(/\s+/g, "").trim();
  if (s === "" || s === "-") return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // comma = thousands separator, dot = decimal
    s = s.replace(/,/g, "");
  } else if (hasComma) {
    // comma = decimal separator
    s = s.replace(/,/g, ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// "2024.05.13 14:30:05" / "2024.05.13 14:30" / "2024-05-13 14:30:05".
// Treated as UTC for now (broker-timezone handling is a later phase).
export function parseMtDate(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const s = raw.replace(/ /g, " ").trim();
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, se ? +se : 0));
  return Number.isNaN(date.getTime()) ? null : date;
}
