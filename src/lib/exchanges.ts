import ccxt, { type Exchange } from "ccxt";

export type ExchangeId = "binance" | "bybit" | "okx";

export type ExchangeMeta = {
  id: ExchangeId;
  name: string;
  needsPassphrase: boolean;
  docsUrl: string;
};

export const SUPPORTED_EXCHANGES: Record<ExchangeId, ExchangeMeta> = {
  binance: {
    id: "binance",
    name: "Binance",
    needsPassphrase: false,
    docsUrl: "https://www.binance.com/en/my/settings/api-management",
  },
  bybit: {
    id: "bybit",
    name: "Bybit",
    needsPassphrase: false,
    docsUrl: "https://www.bybit.com/app/user/api-management",
  },
  okx: {
    id: "okx",
    name: "OKX",
    needsPassphrase: true,
    docsUrl: "https://www.okx.com/account/my-api",
  },
};

export function isExchangeId(value: string): value is ExchangeId {
  return value === "binance" || value === "bybit" || value === "okx";
}

export type ExchangeCredentials = {
  apiKey: string;
  apiSecret: string;
  passphrase?: string | null;
};

// market kind controls which CCXT defaultType is used for a request pass.
export type MarketKind = "spot" | "swap";

export function createExchange(
  id: ExchangeId,
  creds: ExchangeCredentials,
  kind: MarketKind,
): Exchange {
  const ctor = ccxt[id] as unknown as new (config: Record<string, unknown>) => Exchange;
  const exchange = new ctor({
    apiKey: creds.apiKey,
    secret: creds.apiSecret,
    password: creds.passphrase ?? undefined,
    enableRateLimit: true,
    options: {
      defaultType: kind, // spot | swap
    },
  });
  return exchange;
}

// Cached public (keyless) exchange instances for market data (OHLCV).
const publicCache = new Map<string, Exchange>();

export async function getPublicExchange(
  id: ExchangeId,
  kind: MarketKind,
): Promise<Exchange> {
  const key = `${id}:${kind}`;
  let exchange = publicCache.get(key);
  if (!exchange) {
    const ctor = ccxt[id] as unknown as new (
      config: Record<string, unknown>,
    ) => Exchange;
    exchange = new ctor({
      enableRateLimit: true,
      options: { defaultType: kind },
    });
    publicCache.set(key, exchange);
  }
  if (!exchange.markets || Object.keys(exchange.markets).length === 0) {
    await exchange.loadMarkets();
  }
  return exchange;
}

// Pull a realized-PnL value out of an exchange-specific raw trade payload.
function extractRealizedPnl(info: Record<string, unknown> | undefined): number | null {
  if (!info) return null;
  const keys = ["realizedPnl", "realisedPnl", "execPnl", "closedPnl", "fillPnl", "pnl"];
  for (const key of keys) {
    const v = info[key];
    if (v !== undefined && v !== null && v !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export type NormalizedFill = {
  tradeId: string;
  orderId: string | null;
  symbol: string;
  base: string;
  quote: string;
  market: string;
  side: string;
  price: number;
  amount: number;
  cost: number;
  fee: number;
  feeCurrency: string | null;
  realizedPnl: number | null;
  takerOrMaker: string | null;
  timestamp: Date;
};

// Convert a unified CCXT trade into our normalized fill shape.
export function normalizeFill(
  exchange: Exchange,
  trade: Record<string, unknown>,
): NormalizedFill | null {
  const symbol = trade.symbol as string | undefined;
  const price = Number(trade.price);
  const amount = Number(trade.amount);
  if (!symbol || !Number.isFinite(price) || !Number.isFinite(amount) || amount === 0) {
    return null;
  }

  let base = "";
  let quote = "";
  let market = "spot";
  try {
    const m = exchange.market(symbol);
    base = (m.base as string) ?? "";
    quote = (m.quote as string) ?? "";
    market = (m.type as string) ?? (symbol.includes(":") ? "swap" : "spot");
  } catch {
    // fall back to parsing the unified symbol "BASE/QUOTE[:SETTLE]"
    const noSettle = symbol.split(":")[0];
    const [b, q] = noSettle.split("/");
    base = b ?? "";
    quote = q ?? "";
    market = symbol.includes(":") ? "swap" : "spot";
  }

  const feeObj = trade.fee as { cost?: number; currency?: string } | undefined;
  const cost = Number(trade.cost);

  return {
    tradeId: String(trade.id ?? `${symbol}-${trade.timestamp}-${trade.side}-${amount}`),
    orderId: trade.order ? String(trade.order) : null,
    symbol,
    base,
    quote,
    market,
    side: String(trade.side ?? "buy"),
    price,
    amount,
    cost: Number.isFinite(cost) ? cost : price * amount,
    fee: feeObj?.cost ? Number(feeObj.cost) : 0,
    feeCurrency: feeObj?.currency ?? null,
    realizedPnl: extractRealizedPnl(trade.info as Record<string, unknown> | undefined),
    takerOrMaker: (trade.takerOrMaker as string | undefined) ?? null,
    timestamp: new Date(Number(trade.timestamp ?? Date.now())),
  };
}
