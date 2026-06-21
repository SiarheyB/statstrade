import { normalizeSymbol } from "./symbols";
import type { ParsedTrade } from "./types";

export type ImportedTradeInput = {
  accountId: string;
  source: string;
  externalId: string;
  symbol: string;
  base: string;
  quote: string;
  market: string;
  side: string;
  lots: number;
  qty: number;
  contractSize: number;
  entryTime: Date;
  exitTime: Date;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
  grossProfit: number;
  netPnl: number;
  pips: number | null;
  currency: string;
  comment: string | null;
  importBatch: string;
};

// Map a parsed round-trip to an ImportedTrade row. Money is taken from the broker
// (account currency); only pips/qty are derived from price and contract size.
export function toImportedTrade(
  p: ParsedTrade,
  account: { id: string; accountCurrency: string },
  source: string,
  batch: string,
): ImportedTradeInput {
  const info = normalizeSymbol(p.symbol, account.accountCurrency);
  const dir = p.side === "long" ? 1 : -1;
  const pips = info.pipSize > 0
    ? Number((((p.exitPrice - p.entryPrice) / info.pipSize) * dir).toFixed(1))
    : null;
  // MT reports commission already signed (negative = charged). Store it as a
  // positive fee magnitude; swap stays signed (it's P&L, can be + or -).
  const commission = Math.abs(p.commission);
  const netPnl = p.grossProfit + p.swap - commission;
  return {
    accountId: account.id,
    source,
    externalId: p.externalId,
    symbol: info.symbol,
    base: info.base,
    quote: info.quote,
    market: info.market,
    side: p.side,
    lots: p.lots,
    qty: p.lots * info.contractSize,
    contractSize: info.contractSize,
    entryTime: p.entryTime,
    exitTime: p.exitTime,
    entryPrice: p.entryPrice,
    exitPrice: p.exitPrice,
    stopLoss: p.stopLoss,
    takeProfit: p.takeProfit,
    commission,
    swap: p.swap,
    grossProfit: p.grossProfit,
    netPnl,
    pips,
    currency: account.accountCurrency,
    comment: p.comment,
    importBatch: batch,
  };
}
