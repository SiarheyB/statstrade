// A single closed round-trip parsed from a MetaTrader report, before symbol
// normalization. Money fields are in the account currency (as the broker reports).
export type ParsedTrade = {
  externalId: string;
  symbol: string; // raw symbol (may carry a broker suffix)
  side: "long" | "short";
  lots: number;
  entryTime: Date;
  exitTime: Date;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
  grossProfit: number; // broker "Profit" column (before swap/commission)
  comment: string | null;
};

export type MtFormat = "mt4" | "mt5" | "unknown";

export type ParseResult = {
  format: MtFormat;
  trades: ParsedTrade[];
  balance: number | null; // final account balance from the report summary
  errors: string[];
};
