import { tableRows } from "./html";
import { detectFormat } from "./detect";
import { parseNum, parseMtDate } from "./numbers";
import type { ParsedTrade, ParseResult, MtFormat } from "./types";

const SIDES = new Set(["buy", "sell"]);

// Header cell text normalized for matching ("Open Time" -> "opentime", "S / L"
// -> "s/l", "Объём" -> "объём"). Localized (EN/RU) headers are matched by synonym.
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "").trim();

const SYN = {
  ticket: ["ticket", "тикет"],
  position: ["position", "позиция"],
  symbol: ["symbol", "item", "символ", "инструмент"],
};

// Find the first row that is the header of a section (every required synonym
// group has a member among the row's normalized cells).
function findHeader(rows: string[][], groups: string[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map(norm);
    if (groups.every((g) => g.some((label) => cells.includes(label)))) return i;
  }
  return -1;
}

function num(row: string[], i: number): number {
  return i >= 0 && i < row.length ? parseNum(row[i]) : 0;
}
function str(row: string[], i: number): string {
  return i >= 0 && i < row.length ? row[i] : "";
}
function optPrice(row: string[], i: number): number | null {
  const v = num(row, i);
  return v > 0 ? v : null;
}

// MT5 "Positions". Start columns are fixed (Time, Position, Symbol, Type); the
// rest are taken relative to the END of the row, because MT5's HTML inserts an
// extra empty cell after Type in data rows (so data has one more column than the
// header and positional-from-header mapping is off by one).
function buildMt5(row: string[]): ParsedTrade | null {
  const n = row.length;
  if (n < 13) return null;
  const entryTime = parseMtDate(str(row, 0));
  const exitTime = parseMtDate(str(row, n - 5));
  if (!entryTime || !exitTime) return null;
  return {
    externalId: str(row, 1),
    symbol: str(row, 2),
    side: str(row, 3).toLowerCase() === "buy" ? "long" : "short",
    lots: num(row, n - 9),
    entryTime,
    exitTime,
    entryPrice: num(row, n - 8),
    exitPrice: num(row, n - 4),
    stopLoss: optPrice(row, n - 7),
    takeProfit: optPrice(row, n - 6),
    commission: num(row, n - 3),
    swap: num(row, n - 2),
    grossProfit: num(row, n - 1),
    comment: null,
  };
}

// MT4 "Closed Transactions": Ticket, Open Time, Type, Size, Item, Price, S/L,
// T/P, Close Time, Price, Commission, [Taxes], Swap, Profit. Start columns fixed;
// the tail (close time/price + fees) taken from the END, accounting for whether
// a Taxes column is present.
function buildMt4(row: string[], hasTaxes: boolean): ParsedTrade | null {
  const n = row.length;
  if (n < 13) return null;
  const taxes = hasTaxes ? 1 : 0;
  const entryTime = parseMtDate(str(row, 1));
  const exitTime = parseMtDate(str(row, n - 6 - taxes));
  if (!entryTime || !exitTime) return null;
  return {
    externalId: str(row, 0),
    symbol: str(row, 4),
    side: str(row, 2).toLowerCase() === "buy" ? "long" : "short",
    lots: num(row, 3),
    entryTime,
    exitTime,
    entryPrice: num(row, 5),
    exitPrice: num(row, n - 5 - taxes),
    stopLoss: optPrice(row, 6),
    takeProfit: optPrice(row, 7),
    commission: num(row, n - 4 - taxes) + (hasTaxes ? num(row, n - 3) : 0),
    swap: num(row, n - 2),
    grossProfit: num(row, n - 1),
    comment: null,
  };
}

// Walk data rows from `start` until the next section title (a single non-empty
// cell, e.g. "Orders"/"Ордера"); map buy/sell rows, skipping balance rows and
// de-duplicating by externalId.
function collect(
  rows: string[][],
  start: number,
  typeIdx: number,
  build: (row: string[]) => ParsedTrade | null,
  errors: string[],
): ParsedTrade[] {
  const out: ParsedTrade[] = [];
  const seen = new Set<string>();
  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0].trim() !== "") break; // next section title
    const type = str(row, typeIdx).toLowerCase();
    if (!SIDES.has(type)) continue; // balance/credit/blank/sub-header
    const t = build(row);
    if (!t || !t.externalId) continue;
    if (seen.has(t.externalId)) continue;
    seen.add(t.externalId);
    out.push(t);
  }
  if (out.length === 0) errors.push("Не найдено ни одной закрытой сделки");
  return out;
}

function parseMt5(rows: string[][], errors: string[]): ParsedTrade[] {
  const hi = findHeader(rows, [SYN.position, SYN.symbol]);
  if (hi < 0) {
    errors.push("MT5: не найден раздел Positions (Позиции) в отчёте");
    return [];
  }
  return collect(rows, hi + 1, 3, buildMt5, errors);
}

function parseMt4(rows: string[][], errors: string[]): ParsedTrade[] {
  const hi = findHeader(rows, [SYN.ticket, SYN.symbol]);
  if (hi < 0) {
    errors.push("MT4: не найдена таблица закрытых сделок (Closed Transactions)");
    return [];
  }
  const H = rows[hi].map(norm);
  const hasTaxes = H.includes("taxes") || H.includes("налог") || H.includes("налоги");
  return collect(rows, hi + 1, 2, (row) => buildMt4(row, hasTaxes), errors);
}

// Final account balance from the report summary ("Баланс: 717.10" / "Balance:").
function parseBalance(rows: string[][]): number | null {
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const c = norm(row[i]);
      if (c === "баланс:" || c === "balance:" || c === "баланс" || c === "balance") {
        const next = row[i + 1];
        if (next && /\d/.test(next)) return parseNum(next);
      }
      const m = row[i].match(/(?:баланс|balance)\s*:\s*([-\d\s.,]+)/i);
      if (m) {
        const v = parseNum(m[1]);
        if (v) return v;
      }
    }
  }
  return null;
}

// Detect the format and parse the report into closed round-trips.
export function parseStatement(html: string, hint?: MtFormat): ParseResult {
  const format = hint && hint !== "unknown" ? hint : detectFormat(html);
  const rows = tableRows(html);
  const errors: string[] = [];
  let trades: ParsedTrade[] = [];
  if (format === "mt4") trades = parseMt4(rows, errors);
  else if (format === "mt5") trades = parseMt5(rows, errors);
  else errors.push("Не удалось определить формат отчёта (MT4 или MT5)");
  return { format, trades, balance: parseBalance(rows), errors };
}
