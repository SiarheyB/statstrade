import type { Exchange } from "ccxt";
import { prisma } from "./db";
import { decrypt } from "./crypto";
import {
  createExchange,
  isExchangeId,
  normalizeFill,
  type ExchangeId,
  type MarketKind,
  type NormalizedFill,
} from "./exchanges";

const PAGE_LIMIT = 1000;
const MAX_PAGES = 30;
const DEFAULT_LOOKBACK_DAYS = 180;
// Fallback symbols for exchanges that require a symbol and where we cannot infer
// the full traded set (only current balances are visible).
const FALLBACK_QUOTES = ["USDT", "USDC"];
const FALLBACK_BASES = [
  "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "MATIC",
];

export type SyncResult = {
  imported: number;
  fetched: number;
  errors: string[];
};

// Pull trades for one pass (a single defaultType) and return normalized fills.
async function fetchTradesForKind(
  exchange: Exchange,
  since: number,
  errors: string[],
): Promise<NormalizedFill[]> {
  const fills: NormalizedFill[] = [];
  const seen = new Set<string>();

  const collect = (trades: unknown[]) => {
    for (const raw of trades) {
      const fill = normalizeFill(exchange, raw as Record<string, unknown>);
      if (!fill) continue;
      const key = `${fill.symbol}:${fill.tradeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fills.push(fill);
    }
  };

  // Strategy A: fetch all trades without a symbol (works on Bybit/OKX unified).
  if (exchange.has["fetchMyTrades"]) {
    try {
      let cursor = since;
      for (let page = 0; page < MAX_PAGES; page++) {
        const trades = await exchange.fetchMyTrades(undefined, cursor, PAGE_LIMIT);
        if (!trades.length) break;
        collect(trades as unknown[]);
        const last = trades[trades.length - 1];
        const nextCursor = Number(last.timestamp) + 1;
        if (nextCursor <= cursor) break;
        cursor = nextCursor;
        if (trades.length < PAGE_LIMIT) break;
      }
      return fills;
    } catch (err) {
      // Strategy A failed (often: a symbol is required, e.g. Binance) -> fall through.
      errors.push(
        `no-symbol fetch failed (${(err as Error).message}); falling back to per-symbol`,
      );
    }
  }

  // Strategy B: per-symbol iteration over likely symbols (current balances + majors).
  const symbols = await candidateSymbols(exchange, errors);
  for (const symbol of symbols) {
    try {
      let cursor = since;
      for (let page = 0; page < MAX_PAGES; page++) {
        const trades = await exchange.fetchMyTrades(symbol, cursor, PAGE_LIMIT);
        if (!trades.length) break;
        collect(trades as unknown[]);
        const last = trades[trades.length - 1];
        const nextCursor = Number(last.timestamp) + 1;
        if (nextCursor <= cursor) break;
        cursor = nextCursor;
        if (trades.length < PAGE_LIMIT) break;
      }
    } catch (err) {
      errors.push(`${symbol}: ${(err as Error).message}`);
    }
  }
  return fills;
}

// Build a candidate symbol list from current balances plus a list of majors.
async function candidateSymbols(
  exchange: Exchange,
  errors: string[],
): Promise<string[]> {
  const symbols = new Set<string>();
  const markets = exchange.markets ?? {};

  const addPair = (base: string, quote: string) => {
    for (const sym of Object.keys(markets)) {
      const m = markets[sym];
      if (m && m.base === base && m.quote === quote && m.active !== false) {
        symbols.add(sym);
      }
    }
  };

  try {
    const balance = await exchange.fetchBalance();
    const totals = (balance.total ?? {}) as unknown as Record<string, number>;
    for (const asset of Object.keys(totals)) {
      if (FALLBACK_QUOTES.includes(asset)) continue;
      for (const quote of FALLBACK_QUOTES) addPair(asset, quote);
    }
  } catch (err) {
    errors.push(`fetchBalance failed: ${(err as Error).message}`);
  }

  for (const base of FALLBACK_BASES) {
    for (const quote of FALLBACK_QUOTES) addPair(base, quote);
  }

  return Array.from(symbols);
}

function passesFor(marketType: string): MarketKind[] {
  if (marketType === "spot") return ["spot"];
  if (marketType === "futures") return ["swap"];
  return ["spot", "swap"];
}

// Run a sync pass over all auto-sync accounts whose interval has elapsed.
// Sequential to respect per-exchange rate limits. Errors per account are
// swallowed (recorded on the account row by syncAccount).
export async function runDueSyncs(): Promise<{
  due: number;
  synced: string[];
  failed: string[];
}> {
  const now = Date.now();
  const accounts = await prisma.exchangeAccount.findMany({
    where: { autoSync: true },
  });
  const due = accounts.filter((a) => {
    if (a.syncStatus === "syncing") return false;
    if (!a.lastSyncAt) return true;
    return now - a.lastSyncAt.getTime() >= a.syncIntervalMinutes * 60_000;
  });

  const synced: string[] = [];
  const failed: string[] = [];
  for (const a of due) {
    try {
      await syncAccount(a.id);
      synced.push(a.id);
    } catch {
      failed.push(a.id);
    }
  }
  return { due: due.length, synced, failed };
}

// Sync a single exchange account: fetch trades, dedupe, and persist fills.
export async function syncAccount(
  accountId: string,
  opts: { sinceDays?: number } = {},
): Promise<SyncResult> {
  const account = await prisma.exchangeAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) throw new Error("Account not found");
  if (!isExchangeId(account.exchange)) {
    throw new Error(`Unsupported exchange: ${account.exchange}`);
  }

  await prisma.exchangeAccount.update({
    where: { id: accountId },
    data: { syncStatus: "syncing", syncError: null },
  });

  const errors: string[] = [];
  const allFills: NormalizedFill[] = [];
  const since =
    Date.now() - (opts.sinceDays ?? DEFAULT_LOOKBACK_DAYS) * 24 * 3600 * 1000;

  try {
    const creds = {
      apiKey: decrypt(account.apiKey),
      apiSecret: decrypt(account.apiSecret),
      passphrase: account.passphrase ? decrypt(account.passphrase) : null,
    };

    for (const kind of passesFor(account.marketType)) {
      let exchange: Exchange | null = null;
      try {
        exchange = createExchange(account.exchange as ExchangeId, creds, kind);
        await exchange.loadMarkets();
        const fills = await fetchTradesForKind(exchange, since, errors);
        allFills.push(...fills);
      } catch (err) {
        errors.push(`${kind} pass: ${(err as Error).message}`);
      } finally {
        if (exchange && typeof exchange.close === "function") {
          await exchange.close().catch(() => {});
        }
      }
    }

    const imported = await persistFills(accountId, account.exchange, allFills);

    await prisma.exchangeAccount.update({
      where: { id: accountId },
      data: {
        syncStatus: errors.length ? "error" : "idle",
        syncError: errors.length ? errors.slice(0, 5).join(" | ") : null,
        lastSyncAt: new Date(),
      },
    });

    return { imported, fetched: allFills.length, errors };
  } catch (err) {
    await prisma.exchangeAccount.update({
      where: { id: accountId },
      data: { syncStatus: "error", syncError: (err as Error).message },
    });
    throw err;
  }
}

// Insert only fills we haven't seen before for this account.
export async function persistFills(
  accountId: string,
  exchange: string,
  fills: NormalizedFill[],
): Promise<number> {
  if (fills.length === 0) return 0;

  const existing = await prisma.fill.findMany({
    where: { accountId },
    select: { tradeId: true, symbol: true },
  });
  const seen = new Set(existing.map((e) => `${e.symbol}:${e.tradeId}`));

  const fresh = fills.filter((f) => !seen.has(`${f.symbol}:${f.tradeId}`));
  if (fresh.length === 0) return 0;

  // De-dupe within this batch as well.
  const batchSeen = new Set<string>();
  const rows = [];
  for (const f of fresh) {
    const key = `${f.symbol}:${f.tradeId}`;
    if (batchSeen.has(key)) continue;
    batchSeen.add(key);
    rows.push({
      accountId,
      exchange,
      tradeId: f.tradeId,
      orderId: f.orderId,
      symbol: f.symbol,
      base: f.base,
      quote: f.quote,
      market: f.market,
      side: f.side,
      price: f.price,
      amount: f.amount,
      cost: f.cost,
      fee: f.fee,
      feeCurrency: f.feeCurrency,
      realizedPnl: f.realizedPnl,
      takerOrMaker: f.takerOrMaker,
      timestamp: f.timestamp,
    });
  }

  await prisma.fill.createMany({ data: rows });
  return rows.length;
}
