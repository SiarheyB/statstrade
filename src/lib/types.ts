import type { Metrics } from "./analytics/metrics";
import type { TradeSide, TradeResult } from "./analytics/types";

// Trade as serialized over the API (Dates become ISO strings).
export type SerializedTrade = {
  id: string;
  symbol: string;
  base: string;
  quote: string;
  market: string;
  exchange: string;
  accountId: string;
  side: TradeSide;
  entryTime: string;
  exitTime: string;
  durationMs: number;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  returnPct: number;
  fillCount: number;
  result: TradeResult;
  entryPoint: string | null;
  entryType: string | null;
  mistake: string | null;
  pattern: string | null;
  stopLoss: number | null;
};

export type AccountSummary = {
  id: string;
  label: string;
  exchange: string;
  balance: number | null;
};

export type StatsResponse = {
  metrics: Metrics;
  trades: SerializedTrade[];
  fillCount: number;
  symbols: string[];
  accounts: AccountSummary[];
  entryPointOptions: string[];
  entryTypeOptions: string[];
  mistakeOptions: string[];
  patternOptions: string[];
};
