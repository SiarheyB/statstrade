// Minimal fill shape consumed by the analytics layer (subset of the Prisma Fill).
export type FillInput = {
  symbol: string;
  base: string;
  quote: string;
  market: string; // spot | swap | future
  side: string; // buy | sell
  price: number;
  amount: number;
  fee: number;
  feeCurrency: string | null;
  timestamp: Date;
  exchange: string;
  accountId: string;
};

export type TradeSide = "long" | "short";
export type TradeResult = "win" | "loss" | "breakeven";

// A reconstructed round-trip trade (open -> close of a position).
export type RoundTripTrade = {
  id: string;
  symbol: string;
  base: string;
  quote: string;
  market: string;
  exchange: string;
  accountId: string;
  side: TradeSide;
  entryTime: Date;
  exitTime: Date;
  durationMs: number;
  qty: number; // peak position size (base)
  entryPrice: number; // average entry
  exitPrice: number; // average exit
  grossPnl: number; // realized PnL in quote, before fees
  fees: number; // total fees in quote
  netPnl: number; // grossPnl - fees
  returnPct: number; // netPnl / (entryPrice * qty) * 100
  fillCount: number;
  result: TradeResult;
  // Manual annotations (attached after reconstruction).
  entryPoint?: string | null; // ТВХ
  entryType?: string | null; // тип входа
  mistake?: string | null; // ошибка
  pattern?: string | null; // паттерн
  stopLoss?: number | null; // цена стоп-лосса
  note?: string | null; // комментарий к сделке
};
