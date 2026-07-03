import type { FillInput, RoundTripTrade, TradeResult } from "./types";

// Relative tolerance for treating a net position as flat.
const REL_EPS = 1e-9;

// Convert a fill's fee into the quote currency (best effort).
function feeInQuote(fill: FillInput): number {
  if (!fill.fee) return 0;
  if (!fill.feeCurrency) return fill.fee; // assume already quote
  if (fill.feeCurrency === fill.quote) return fill.fee;
  if (fill.feeCurrency === fill.base) return fill.fee * fill.price;
  return 0; // unknown currency (e.g. exchange token) — cannot convert reliably
}

type OpenTrade = {
  symbol: string;
  base: string;
  quote: string;
  market: string;
  exchange: string;
  accountId: string;
  side: "long" | "short";
  entryTime: Date;
  exitTime: Date;
  maxQty: number;
  grossPnl: number;
  fees: number;
  fillCount: number;
  exitNotional: number; // sum(closePrice * closeQty)
  exitQty: number; // sum(closeQty)
  exchangePnl: number; // Σ realizedPnl закрывающих филлов (когда биржа его отдаёт)
  closeFills: number; // число закрывающих филлов
  pnlFills: number; // из них с непустым realizedPnl
};

function classify(netPnl: number): TradeResult {
  if (Math.abs(netPnl) < 1e-9) return "breakeven";
  return netPnl > 0 ? "win" : "loss";
}

function finalize(
  open: OpenTrade,
  avgEntry: number,
  out: RoundTripTrade[],
): void {
  const qty = open.maxQty;
  const fees = open.fees;
  // Фьючерсы: если КАЖДЫЙ закрывающий филл принёс биржевой realizedPnl, берём
  // его сумму вместо ценовой модели — она сходится с биржей до цента (учтены
  // округления, ADL, ликвидации). Иначе (спот, частичные данные) — ценовая
  // модель как раньше.
  const useExchangePnl =
    open.market !== "spot" && open.closeFills > 0 && open.pnlFills === open.closeFills;
  const grossPnl = useExchangePnl ? open.exchangePnl : open.grossPnl;
  const netPnl = grossPnl - fees;
  const exitPrice = open.exitQty > 0 ? open.exitNotional / open.exitQty : avgEntry;
  const costBasis = avgEntry * qty;
  // Stable key for attaching manual annotations: a trade is uniquely identified
  // by account + symbol + market + the timestamp of its opening fill.
  out.push({
    id: `${open.accountId}:${open.symbol}:${open.market}:${open.entryTime.getTime()}`,
    symbol: open.symbol,
    base: open.base,
    quote: open.quote,
    market: open.market,
    exchange: open.exchange,
    accountId: open.accountId,
    side: open.side,
    entryTime: open.entryTime,
    exitTime: open.exitTime,
    durationMs: open.exitTime.getTime() - open.entryTime.getTime(),
    qty,
    entryPrice: avgEntry,
    exitPrice,
    grossPnl,
    fees,
    netPnl,
    returnPct: costBasis > 0 ? (netPnl / costBasis) * 100 : 0,
    fillCount: open.fillCount,
    result: classify(netPnl),
  });
}

// Reconstruct round-trip trades from a flat list of fills.
// Fills are grouped per account+symbol+market and matched with an average-cost
// model: a trade opens when the position leaves zero and closes when it returns
// to zero (a flip closes one trade and opens another).
export function reconstructTrades(fills: FillInput[]): RoundTripTrade[] {
  const groups = new Map<string, FillInput[]>();
  for (const fill of fills) {
    const key = `${fill.accountId}|${fill.symbol}|${fill.market}`;
    const arr = groups.get(key);
    if (arr) arr.push(fill);
    else groups.set(key, [fill]);
  }

  const trades: RoundTripTrade[] = [];

  for (const groupFills of groups.values()) {
    groupFills.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    let pos = 0; // signed base quantity
    let avgEntry = 0;
    let open: OpenTrade | null = null;

    const newOpen = (fill: FillInput, qty: number, fee: number): OpenTrade => ({
      symbol: fill.symbol,
      base: fill.base,
      quote: fill.quote,
      market: fill.market,
      exchange: fill.exchange,
      accountId: fill.accountId,
      side: qty > 0 ? "long" : "short",
      entryTime: fill.timestamp,
      exitTime: fill.timestamp,
      maxQty: Math.abs(qty),
      grossPnl: 0,
      fees: fee,
      fillCount: 1,
      exitNotional: 0,
      exitQty: 0,
      exchangePnl: 0,
      closeFills: 0,
      pnlFills: 0,
    });

    for (const fill of groupFills) {
      const signed = fill.side === "buy" ? fill.amount : -fill.amount;
      if (signed === 0) continue;
      const fee = feeInQuote(fill);
      const eps = Math.max(Math.abs(pos), Math.abs(signed), 1) * REL_EPS;

      if (Math.abs(pos) < eps) {
        // flat -> opening a new position
        avgEntry = fill.price;
        pos = signed;
        open = newOpen(fill, signed, fee);
        continue;
      }

      const sameDir = Math.sign(signed) === Math.sign(pos);
      if (sameDir) {
        // increasing the position -> update average entry
        const absPos = Math.abs(pos);
        const absFill = Math.abs(signed);
        avgEntry = (avgEntry * absPos + fill.price * absFill) / (absPos + absFill);
        pos += signed;
        if (open) {
          open.maxQty = Math.max(open.maxQty, Math.abs(pos));
          open.fees += fee;
          open.fillCount += 1;
          open.exitTime = fill.timestamp;
        }
        continue;
      }

      // opposite direction -> realize PnL on the closed portion
      const closeQty = Math.min(Math.abs(signed), Math.abs(pos));
      const longSide = pos > 0;
      const pnl = longSide
        ? (fill.price - avgEntry) * closeQty
        : (avgEntry - fill.price) * closeQty;
      if (open) {
        open.grossPnl += pnl;
        open.fees += fee;
        open.fillCount += 1;
        open.exitTime = fill.timestamp;
        open.exitNotional += fill.price * closeQty;
        open.exitQty += closeQty;
        open.closeFills += 1;
        if (fill.realizedPnl != null) {
          open.exchangePnl += fill.realizedPnl;
          open.pnlFills += 1;
        }
      }

      const newPos = pos + signed;
      if (Math.abs(newPos) < eps) {
        // fully closed
        if (open) finalize(open, avgEntry, trades);
        open = null;
        pos = 0;
      } else if (Math.sign(newPos) !== Math.sign(pos)) {
        // flipped: close the old trade, open a fresh one with the remainder
        if (open) finalize(open, avgEntry, trades);
        avgEntry = fill.price;
        pos = newPos;
        // fee already attributed to the closing trade; new trade starts at 0
        open = newOpen(fill, newPos, 0);
      } else {
        // partial close, same side remains (average entry unchanged)
        pos = newPos;
      }
    }

    // Any position still open at the end is unrealized and intentionally
    // excluded from realized-PnL statistics.
  }

  trades.sort((a, b) => a.exitTime.getTime() - b.exitTime.getTime());
  return trades;
}
