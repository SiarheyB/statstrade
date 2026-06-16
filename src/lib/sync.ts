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
// How deep a full scan reaches, and how an incremental re-sync overlaps.
const FULL_LOOKBACK_DAYS = 365 * 3;
const INCREMENTAL_OVERLAP_DAYS = 7;
const INCREMENTAL_FALLBACK_DAYS = 30;
// Time budget for one chunk — kept under the serverless maxDuration (60s) so a
// chunk always finishes and checkpoints before the platform kills the function.
const CHUNK_BUDGET_MS = 42_000;

// Exchanges whose API requires a symbol on every trade query (no "all trades"
// endpoint). For these we enumerate every candidate pair; the rest fetch all
// trades in one pass.
const REQUIRES_SYMBOL: Record<ExchangeId, boolean> = {
  binance: true,
  bybit: false,
  okx: false,
};

// Quote currencies whose pairs a full scan enumerates (per-symbol exchanges).
const SCAN_QUOTES = [
  "USDT", "USDC", "FDUSD", "TUSD", "BUSD", "BTC", "ETH", "BNB", "EUR", "TRY",
];
// Majors always probed on incremental scans, to catch newly-traded pairs.
const MAJOR_BASES = [
  "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "TON",
];
const MAJOR_QUOTES = ["USDT", "USDC"];

export type SyncProgress = {
  status: "syncing" | "idle" | "error";
  phase: "full" | "incremental" | null;
  done: number;
  total: number;
  imported: number;
  error: string | null;
};

function passesFor(marketType: string): MarketKind[] {
  if (marketType === "spot") return ["spot"];
  if (marketType === "futures") return ["swap"];
  return ["spot", "swap"];
}

// A scan task is "kind|symbol"; an empty symbol means "fetch all trades".
const encodeTask = (kind: MarketKind, symbol: string) => `${kind}|${symbol}`;
function decodeTask(task: string): { kind: MarketKind; symbol: string } {
  const i = task.indexOf("|");
  return { kind: task.slice(0, i) as MarketKind, symbol: task.slice(i + 1) };
}

// Paginate trades for one symbol (or all trades when symbol is undefined).
async function fetchTrades(
  exchange: Exchange,
  symbol: string | undefined,
  since: number,
): Promise<NormalizedFill[]> {
  const fills: NormalizedFill[] = [];
  const seen = new Set<string>();
  let cursor = since;
  for (let page = 0; page < MAX_PAGES; page++) {
    const trades = (await exchange.fetchMyTrades(symbol, cursor, PAGE_LIMIT)) as unknown[];
    if (!trades.length) break;
    for (const raw of trades) {
      const fill = normalizeFill(exchange, raw as Record<string, unknown>);
      if (!fill) continue;
      const key = `${fill.symbol}:${fill.tradeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fills.push(fill);
    }
    const last = trades[trades.length - 1] as { timestamp?: number };
    const next = Number(last.timestamp) + 1;
    if (!Number.isFinite(next) || next <= cursor) break;
    cursor = next;
    if (trades.length < PAGE_LIMIT) break;
  }
  return fills;
}

type Creds = { apiKey: string; apiSecret: string; passphrase: string | null };

function credsFor(account: {
  apiKey: string;
  apiSecret: string;
  passphrase: string | null;
}): Creds {
  return {
    apiKey: decrypt(account.apiKey),
    apiSecret: decrypt(account.apiSecret),
    passphrase: account.passphrase ? decrypt(account.passphrase) : null,
  };
}

// Build the ordered task plan for a scan.
async function buildPlan(
  exchangeId: ExchangeId,
  marketType: string,
  phase: "full" | "incremental",
  creds: Creds,
  accountId: string,
): Promise<string[]> {
  const kinds = passesFor(marketType);

  // All-at-once exchanges (Bybit/OKX): one task per market kind.
  if (!REQUIRES_SYMBOL[exchangeId]) {
    return kinds.map((kind) => encodeTask(kind, ""));
  }

  // Per-symbol exchanges (Binance): enumerate candidate pairs per kind.
  const tradedByKind = new Map<MarketKind, Set<string>>();
  if (phase === "incremental") {
    const fills = await prisma.fill.findMany({
      where: { accountId },
      select: { symbol: true, market: true },
      distinct: ["symbol"],
    });
    for (const f of fills) {
      const kind: MarketKind = f.market === "spot" ? "spot" : "swap";
      (tradedByKind.get(kind) ?? tradedByKind.set(kind, new Set()).get(kind)!).add(f.symbol);
    }
  }

  const tasks: string[] = [];
  for (const kind of kinds) {
    const exchange = createExchange(exchangeId, creds, kind);
    try {
      await exchange.loadMarkets();
      const markets = (exchange.markets ?? {}) as Record<string, Record<string, unknown>>;
      const isKind = (m: Record<string, unknown>) =>
        kind === "spot" ? m.type === "spot" : m.type === "swap";
      const symbols = new Set<string>();

      if (phase === "full") {
        for (const sym of Object.keys(markets)) {
          const m = markets[sym];
          if (!m || m.active === false) continue;
          if (isKind(m) && SCAN_QUOTES.includes(m.quote as string)) symbols.add(sym);
        }
      } else {
        for (const s of tradedByKind.get(kind) ?? []) symbols.add(s);
        try {
          const balance = await exchange.fetchBalance();
          const totals = (balance.total ?? {}) as unknown as Record<string, number>;
          for (const asset of Object.keys(totals)) {
            if ((totals[asset] ?? 0) <= 0) continue;
            for (const sym of Object.keys(markets)) {
              const m = markets[sym];
              if (m && isKind(m) && m.base === asset && MAJOR_QUOTES.includes(m.quote as string)) {
                symbols.add(sym);
              }
            }
          }
        } catch {
          // balance is best-effort
        }
        for (const sym of Object.keys(markets)) {
          const m = markets[sym];
          if (!m || m.active === false || !isKind(m)) continue;
          if (MAJOR_BASES.includes(m.base as string) && MAJOR_QUOTES.includes(m.quote as string)) {
            symbols.add(sym);
          }
        }
      }

      for (const sym of symbols) tasks.push(encodeTask(kind, sym));
    } catch {
      // skip a kind whose markets fail to load
    } finally {
      if (typeof exchange.close === "function") await exchange.close().catch(() => {});
    }
  }
  return tasks;
}

function sinceForPhase(
  phase: "full" | "incremental" | null,
  lastSyncAt: Date | null,
): number {
  const now = Date.now();
  if (phase === "incremental") {
    return lastSyncAt
      ? lastSyncAt.getTime() - INCREMENTAL_OVERLAP_DAYS * 86_400_000
      : now - INCREMENTAL_FALLBACK_DAYS * 86_400_000;
  }
  return now - FULL_LOOKBACK_DAYS * 86_400_000;
}

// Process one time-bounded chunk of the active scan: fetch trades for the next
// batch of tasks, persist fills, advance the cursor, and report progress.
async function processChunk(accountId: string): Promise<SyncProgress> {
  const account = await prisma.exchangeAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Account not found");

  const plan: string[] = account.syncPlan ? JSON.parse(account.syncPlan) : [];
  const total = plan.length;
  const phase = (account.syncPhase as "full" | "incremental" | null) ?? null;

  if (total === 0) {
    await finishScan(accountId, phase, account.syncImported, [], account.fullSyncAt);
    return { status: "idle", phase: null, done: 0, total: 0, imported: account.syncImported, error: null };
  }

  const creds = credsFor(account);
  const since = sinceForPhase(phase, account.lastSyncAt);
  const exchanges = new Map<MarketKind, Exchange>();
  const errors: string[] = [];
  let imported = account.syncImported;
  let cursor = account.syncCursor;
  const start = Date.now();

  try {
    while (cursor < total && Date.now() - start < CHUNK_BUDGET_MS) {
      const { kind, symbol } = decodeTask(plan[cursor]);
      try {
        let ex = exchanges.get(kind);
        if (!ex) {
          ex = createExchange(account.exchange as ExchangeId, creds, kind);
          await ex.loadMarkets();
          exchanges.set(kind, ex);
        }
        const fills = await fetchTrades(ex, symbol || undefined, since);
        imported += await persistFills(accountId, account.exchange, fills);
      } catch (err) {
        errors.push(`${symbol || kind}: ${(err as Error).message}`);
      }
      cursor++;
      if (cursor % 20 === 0) {
        await prisma.exchangeAccount.update({
          where: { id: accountId },
          data: { syncCursor: cursor, syncImported: imported },
        });
      }
    }
  } finally {
    for (const ex of exchanges.values()) {
      if (typeof ex.close === "function") await ex.close().catch(() => {});
    }
  }

  if (cursor >= total) {
    const hardFail = errors.length > 0 && imported === 0;
    await finishScan(accountId, phase, imported, errors, account.fullSyncAt);
    return {
      status: hardFail ? "error" : "idle",
      phase,
      done: total,
      total,
      imported,
      error: errors.length ? errors.slice(0, 3).join(" | ") : null,
    };
  }

  await prisma.exchangeAccount.update({
    where: { id: accountId },
    data: { syncStatus: "syncing", syncCursor: cursor, syncImported: imported },
  });
  return { status: "syncing", phase, done: cursor, total, imported, error: null };
}

async function finishScan(
  accountId: string,
  phase: "full" | "incremental" | null,
  imported: number,
  errors: string[],
  prevFullSyncAt: Date | null,
): Promise<void> {
  const now = new Date();
  const hardFail = errors.length > 0 && imported === 0;
  await prisma.exchangeAccount.update({
    where: { id: accountId },
    data: {
      syncStatus: hardFail ? "error" : "idle",
      syncError: errors.length ? errors.slice(0, 5).join(" | ") : null,
      syncPlan: null,
      syncCursor: 0,
      syncTotal: 0,
      syncImported: 0,
      syncPhase: null,
      lastSyncAt: now,
      fullSyncAt: phase === "full" && !hardFail ? now : prevFullSyncAt,
    },
  });
}

// Public entry: start a new scan or advance the in-progress one. The client
// calls this repeatedly until status !== "syncing", rendering a progress bar.
export async function syncChunk(
  accountId: string,
  opts: { rescan?: boolean } = {},
): Promise<SyncProgress> {
  const account = await prisma.exchangeAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Account not found");
  if (!isExchangeId(account.exchange)) {
    throw new Error(`Unsupported exchange: ${account.exchange}`);
  }

  if (opts.rescan) {
    await prisma.exchangeAccount.update({
      where: { id: accountId },
      data: {
        syncStatus: "idle",
        syncPlan: null,
        syncCursor: 0,
        syncTotal: 0,
        syncImported: 0,
        syncPhase: null,
        fullSyncAt: null,
      },
    });
    account.syncStatus = "idle";
    account.syncPlan = null;
    account.fullSyncAt = null;
  }

  // Continue an in-progress scan.
  if (account.syncStatus === "syncing" && account.syncPlan) {
    return processChunk(accountId);
  }

  // Start a new scan: build the plan (heavy loadMarkets) and return immediately;
  // the client's next call processes the first chunk. This keeps the start call
  // well under the serverless time limit.
  const phase: "full" | "incremental" = account.fullSyncAt ? "incremental" : "full";
  await prisma.exchangeAccount.update({
    where: { id: accountId },
    data: { syncStatus: "syncing", syncPhase: phase, syncError: null, syncCursor: 0, syncImported: 0 },
  });

  let plan: string[];
  try {
    plan = await buildPlan(
      account.exchange as ExchangeId,
      account.marketType,
      phase,
      credsFor(account),
      accountId,
    );
  } catch (err) {
    await prisma.exchangeAccount.update({
      where: { id: accountId },
      data: { syncStatus: "error", syncError: (err as Error).message, syncPhase: null },
    });
    return { status: "error", phase: null, done: 0, total: 0, imported: 0, error: (err as Error).message };
  }

  if (plan.length === 0) {
    await finishScan(accountId, phase, 0, [], account.fullSyncAt);
    return { status: "idle", phase, done: 0, total: 0, imported: 0, error: null };
  }

  await prisma.exchangeAccount.update({
    where: { id: accountId },
    data: { syncPlan: JSON.stringify(plan), syncTotal: plan.length, syncCursor: 0, syncImported: 0 },
  });
  return { status: "syncing", phase, done: 0, total: plan.length, imported: 0, error: null };
}

// Advance one chunk for each due auto-sync account (used by the cron endpoint).
// Sequential to respect per-exchange rate limits.
export async function runDueSyncs(): Promise<{
  due: number;
  advanced: string[];
  failed: string[];
}> {
  const now = Date.now();
  const accounts = await prisma.exchangeAccount.findMany({ where: { autoSync: true } });
  const due = accounts.filter((a) => {
    if (a.syncStatus === "syncing") return true; // keep advancing an active scan
    if (!a.lastSyncAt) return true;
    return now - a.lastSyncAt.getTime() >= a.syncIntervalMinutes * 60_000;
  });

  const advanced: string[] = [];
  const failed: string[] = [];
  for (const a of due) {
    try {
      await syncChunk(a.id);
      advanced.push(a.id);
    } catch {
      failed.push(a.id);
    }
  }
  return { due: due.length, advanced, failed };
}

// Insert only fills we haven't seen before for this account.
export async function persistFills(
  accountId: string,
  exchange: string,
  fills: NormalizedFill[],
): Promise<number> {
  if (fills.length === 0) return 0;

  // Dedupe within the batch; cross-batch/historical dupes are rejected by the
  // @@unique([accountId, tradeId, symbol]) constraint via skipDuplicates, so we
  // avoid scanning the whole fills table on every per-symbol call.
  const batchSeen = new Set<string>();
  const rows = [];
  for (const f of fills) {
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

  if (rows.length === 0) return 0;
  const res = await prisma.fill.createMany({ data: rows, skipDuplicates: true });
  return res.count;
}
