import ccxt, { type Exchange } from "ccxt";

// ccxt id бирж, поддержанных для синхронизации аккаунтов — вынесены в
// exchangeIds.ts (без импорта ccxt), чтобы клиентские компоненты могли
// использовать ExchangeId/isExchangeId, не затягивая ccxt в браузерный бандл.
import type { ExchangeId } from "@/lib/exchangeIds";
export type { ExchangeId, ExchangeMeta } from "@/lib/exchangeIds";
export { SUPPORTED_EXCHANGES, EXCHANGE_IDS, isExchangeId } from "@/lib/exchangeIds";

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
  demo = false,
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
  // Demo / testnet keys only work against the exchange's demo environment.
  // Bybit has its own "Demo Trading" host (enableDemoTrading); Binance (testnet)
  // and OKX (demo trading, x-simulated-trading header) use CCXT's unified
  // sandbox mode.
  if (demo) {
    const ex = exchange as unknown as {
      enableDemoTrading?: (v: boolean) => void;
      setSandboxMode?: (v: boolean) => void;
    };
    if (id === "bybit" && typeof ex.enableDemoTrading === "function") {
      ex.enableDemoTrading(true);
    } else if (typeof ex.setSandboxMode === "function") {
      ex.setSandboxMode(true);
    }
  }
  return exchange;
}

const STABLECOINS = ["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI"];

// Fetch the account's balance/equity in USDT terms (sum of stablecoin totals).
// For derivatives wallets total.USDT is the equity; for spot it's the cash.
// Returns null on failure so sync stays non-fatal.
export async function fetchBalanceUsdt(
  id: ExchangeId,
  creds: ExchangeCredentials,
  kind: MarketKind,
  demo = false,
): Promise<number | null> {
  const exchange = createExchange(id, creds, kind, demo);
  try {
    const bal = await exchange.fetchBalance();
    const totals = (bal.total ?? {}) as unknown as Record<string, number>;
    let sum = 0;
    let seen = false;
    for (const s of STABLECOINS) {
      const v = Number(totals[s]);
      if (Number.isFinite(v) && v !== 0) {
        sum += v;
        seen = true;
      }
    }
    return seen ? sum : 0;
  } catch {
    return null;
  } finally {
    if (typeof exchange.close === "function") await exchange.close().catch(() => {});
  }
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
  const priceNum = Number(trade.price);
  const amountNum = Number(trade.amount);
  if (!symbol || trade.price == null || trade.amount == null || !Number.isFinite(priceNum) || !Number.isFinite(amountNum) || amountNum === 0) {
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
    tradeId: String(trade.id ?? `${symbol}-${trade.timestamp}-${trade.side}-${amountNum}`),
    orderId: trade.order ? String(trade.order) : null,
    symbol,
    base,
    quote,
    market,
    side: String(trade.side ?? "buy"),
    price: priceNum,
    amount: amountNum,
    cost: Number.isFinite(cost) ? cost : priceNum * amountNum,
    fee: feeObj?.cost ? Number(feeObj.cost) : 0,
    feeCurrency: feeObj?.currency ?? null,
    realizedPnl: extractRealizedPnl(trade.info as Record<string, unknown> | undefined),
    takerOrMaker: (trade.takerOrMaker as string | undefined) ?? null,
    timestamp: new Date(trade.timestamp ?? Date.now()),
  };
}
