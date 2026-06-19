import type { Exchange } from "ccxt";
import { prisma } from "./db";
import { decrypt } from "./crypto";
import {
  createExchange,
  fetchBalanceUsdt,
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
// Binance futures only returns trades inside a bounded window, so we walk back
// in fixed steps. Income discovery (below) bounds how far we actually walk.
const FUTURES_WINDOW_MS = 7 * 86_400_000;
const FUTURES_MAX_WINDOWS = 230;
const FUTURES_DISCOVERY_INCREMENTAL_DAYS = 90;
// Time budget for one chunk — kept under the serverless maxDuration (60s) so a
// chunk always finishes and checkpoints before the platform kills the function.
const CHUNK_BUDGET_MS = 42_000;

// Exchanges whose API requires a symbol on every trade query (no "all trades"
// endpoint). For these we enumerate candidate pairs; the rest fetch all trades
// in one pass.
const REQUIRES_SYMBOL: Record<ExchangeId, boolean> = {
  binance: true,
  bybit: false,
  okx: false,
};

// Quote currencies whose spot pairs a full scan enumerates (per-symbol exchanges).
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

// A scan task is "kind|symbol" (empty symbol = fetch all trades). Futures tasks
// carry a third "|floorMs" — the start of activity, so we don't walk empty
// 7-day windows back further than the trader was actually active.
const encodeTask = (kind: MarketKind, symbol: string, floor?: number) =>
  floor !== undefined ? `${kind}|${symbol}|${floor}` : `${kind}|${symbol}`;
function decodeTask(task: string): { kind: MarketKind; symbol: string; floor?: number } {
  const parts = task.split("|");
  return {
    kind: parts[0] as MarketKind,
    symbol: parts[1] ?? "",
    floor: parts[2] ? Number(parts[2]) : undefined,
  };
}

// Discover which Binance futures symbols were actually traded (and the earliest
// activity time) from income history — enumerating all perps × time windows is
// infeasible. Returns raw exchange ids (e.g. "BTCUSDT").
async function discoverFutures(
  exchange: Exchange,
  sinceFloor: number,
): Promise<{ ids: Set<string>; earliest: number }> {
  const ids = new Set<string>();
  let earliest = Date.now();
  const api = exchange as unknown as {
    fapiPrivateGetIncome?: (params: Record<string, unknown>) => Promise<unknown[]>;
  };
  if (typeof api.fapiPrivateGetIncome !== "function") return { ids, earliest };

  let startTime = sinceFloor;
  for (let page = 0; page < 60; page++) {
    let rows: unknown[];
    try {
      rows = await api.fapiPrivateGetIncome({ startTime, limit: 1000 });
    } catch {
      break;
    }
    if (!Array.isArray(rows) || rows.length === 0) break;
    let maxTime = startTime;
    for (const r of rows) {
      const rec = r as { symbol?: string; time?: number | string };
      if (rec.symbol) ids.add(rec.symbol);
      const t = Number(rec.time);
      if (Number.isFinite(t)) {
        if (t < earliest) earliest = t;
        if (t > maxTime) maxTime = t;
      }
    }
    if (rows.length < 1000 || maxTime <= startTime) break;
    startTime = maxTime + 1;
  }
  return { ids: ids, earliest: ids.size ? earliest : Date.now() };
}

// Some exchanges reject trade queries older than a fixed window (Bybit allows
// ~2 years). Clamp the lookback floor so the request stays valid.
const MAX_LOOKBACK_DAYS: Partial<Record<ExchangeId, number>> = { bybit: 720 };
// Bybit returns executions only within ~7-day query windows, so page in time
// steps (newest first) instead of one forward stream from `since`.
const WINDOW_DAYS: Partial<Record<ExchangeId, number>> = { bybit: 7 };

// Pull trades for one symbol (or all, when symbol is undefined). The pagination
// strategy is exchange/market specific because Binance has no "all trades" call
// and applies time windows that silently return nothing if used naively.
async function fetchTrades(
  exchange: Exchange,
  symbol: string | undefined,
  sinceFloor: number,
  exchangeId: ExchangeId,
  kind: MarketKind,
): Promise<NormalizedFill[]> {
  const cap = MAX_LOOKBACK_DAYS[exchangeId];
  if (cap) sinceFloor = Math.max(sinceFloor, Date.now() - cap * 86_400_000);
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

  if (!REQUIRES_SYMBOL[exchangeId]) {
    const windowDays = WINDOW_DAYS[exchangeId];
    if (windowDays) {
      // Bybit: walk back in fixed time windows (executions are capped per query),
      // collecting across windows and stopping after a run of empty ones.
      const windowMs = windowDays * 86_400_000;
      let end = Date.now();
      let emptyStreak = 0;
      for (let w = 0; w < FUTURES_MAX_WINDOWS && end > sinceFloor; w++) {
        const start = Math.max(sinceFloor, end - windowMs);
        let got = 0;
        let inner = start;
        for (let p = 0; p < 5; p++) {
          const trades = (await exchange.fetchMyTrades(symbol, inner, PAGE_LIMIT, {
            endTime: end,
          })) as unknown[];
          if (!trades.length) break;
          got += trades.length;
          collect(trades);
          if (trades.length < PAGE_LIMIT) break;
          let newest = inner;
          for (const t of trades) {
            const ts = Number((t as { timestamp?: number }).timestamp);
            if (Number.isFinite(ts) && ts > newest) newest = ts;
          }
          if (newest <= inner) break;
          inner = newest + 1;
        }
        emptyStreak = got === 0 ? emptyStreak + 1 : 0;
        if (emptyStreak >= 8) break; // ~8 weeks of no trades → assume done
        end = start - 1;
      }
      return fills.filter((f) => f.timestamp.getTime() >= sinceFloor);
    }

    // OKX etc.: one continuous forward stream from the floor.
    let cursor = sinceFloor;
    for (let page = 0; page < MAX_PAGES; page++) {
      const trades = (await exchange.fetchMyTrades(symbol, cursor, PAGE_LIMIT)) as unknown[];
      if (!trades.length) break;
      collect(trades);
      const last = trades[trades.length - 1] as { timestamp?: number };
      const next = Number(last.timestamp) + 1;
      if (!Number.isFinite(next) || next <= cursor) break;
      cursor = next;
      if (trades.length < PAGE_LIMIT) break;
    }
    return fills;
  }

  // Binance futures: API returns only a bounded window (and the last 7 days by
  // default). Walk back in 7-day windows from now down to the floor.
  if (kind === "swap") {
    let end = Date.now();
    for (let w = 0; w < FUTURES_MAX_WINDOWS && end > sinceFloor; w++) {
      const start = Math.max(sinceFloor, end - FUTURES_WINDOW_MS);
      let inner = start;
      for (let p = 0; p < 5; p++) {
        const trades = (await exchange.fetchMyTrades(symbol, inner, PAGE_LIMIT, {
          endTime: end,
        })) as unknown[];
        if (!trades.length) break;
        collect(trades);
        if (trades.length < PAGE_LIMIT) break;
        let newest = inner;
        for (const t of trades) {
          const ts = Number((t as { timestamp?: number }).timestamp);
          if (Number.isFinite(ts) && ts > newest) newest = ts;
        }
        if (newest <= inner) break;
        inner = newest + 1;
      }
      end = start - 1;
    }
    return fills.filter((f) => f.timestamp.getTime() >= sinceFloor);
  }

  // Binance spot: most-recent first (no startTime → avoids the 24h window),
  // then page backwards by endTime down to the floor.
  let endTime: number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = endTime ? { endTime } : {};
    const trades = (await exchange.fetchMyTrades(symbol, undefined, PAGE_LIMIT, params)) as unknown[];
    if (!trades.length) break;
    collect(trades);
    let oldest = Infinity;
    for (const t of trades) {
      const ts = Number((t as { timestamp?: number }).timestamp);
      if (Number.isFinite(ts) && ts < oldest) oldest = ts;
    }
    if (!Number.isFinite(oldest) || oldest <= sinceFloor) break;
    if (trades.length < PAGE_LIMIT) break;
    endTime = oldest - 1;
  }
  return fills.filter((f) => f.timestamp.getTime() >= sinceFloor);
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
  diag: string[],
  demo: boolean,
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

  const fullFloor = Date.now() - FULL_LOOKBACK_DAYS * 86_400_000;
  const tasks: string[] = [];

  for (const kind of kinds) {
    const exchange = createExchange(exchangeId, creds, kind, demo);
    try {
      await exchange.loadMarkets();
      const markets = (exchange.markets ?? {}) as unknown as Record<string, Record<string, unknown>>;
      const symbols = new Set<string>();

      if (kind === "swap") {
        // Futures: discover traded symbols (+ earliest activity) via income.
        const discoverSince =
          phase === "full"
            ? fullFloor
            : Date.now() - FUTURES_DISCOVERY_INCREMENTAL_DAYS * 86_400_000;
        const { ids, earliest } = await discoverFutures(exchange, discoverSince);
        const idToSymbol = new Map<string, string>();
        for (const sym of Object.keys(markets)) {
          const m = markets[sym];
          if (m && m.type === "swap" && typeof m.id === "string") idToSymbol.set(m.id, sym);
        }
        for (const id of ids) {
          const s = idToSymbol.get(id);
          if (s) symbols.add(s);
        }
        for (const s of tradedByKind.get("swap") ?? []) symbols.add(s);
        diag.push(
          `swap: ${Object.keys(markets).length} markets, ${ids.size} traded, ${symbols.size} pairs`,
        );
        // Floor a day before earliest activity so we don't over-walk empty windows.
        const floor = Math.max(fullFloor, earliest - 86_400_000);
        for (const sym of symbols) tasks.push(encodeTask("swap", sym, floor));
        continue;
      }

      // Spot.
      if (phase === "full") {
        for (const sym of Object.keys(markets)) {
          const m = markets[sym];
          if (!m || m.active === false) continue;
          if (m.type === "spot" && SCAN_QUOTES.includes(m.quote as string)) symbols.add(sym);
        }
      } else {
        for (const s of tradedByKind.get("spot") ?? []) symbols.add(s);
        try {
          const balance = await exchange.fetchBalance();
          const totals = (balance.total ?? {}) as unknown as Record<string, number>;
          for (const asset of Object.keys(totals)) {
            if ((totals[asset] ?? 0) <= 0) continue;
            for (const sym of Object.keys(markets)) {
              const m = markets[sym];
              if (m && m.type === "spot" && m.base === asset && MAJOR_QUOTES.includes(m.quote as string)) {
                symbols.add(sym);
              }
            }
          }
        } catch {
          // balance is best-effort
        }
        for (const sym of Object.keys(markets)) {
          const m = markets[sym];
          if (!m || m.active === false || m.type !== "spot") continue;
          if (MAJOR_BASES.includes(m.base as string) && MAJOR_QUOTES.includes(m.quote as string)) {
            symbols.add(sym);
          }
        }
      }

      diag.push(`spot: ${Object.keys(markets).length} markets, ${symbols.size} pairs`);
      for (const sym of symbols) tasks.push(encodeTask("spot", sym));
    } catch (err) {
      diag.push(`${kind} setup failed: ${(err as Error).message}`);
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
  const baseSince = sinceForPhase(phase, account.lastSyncAt);
  const exchangeId = account.exchange as ExchangeId;
  const exchanges = new Map<MarketKind, Exchange>();
  const errors: string[] = [];
  let imported = account.syncImported;
  let cursor = account.syncCursor;
  const start = Date.now();

  try {
    while (cursor < total && Date.now() - start < CHUNK_BUDGET_MS) {
      const { kind, symbol, floor } = decodeTask(plan[cursor]);
      try {
        let ex = exchanges.get(kind);
        if (!ex) {
          ex = createExchange(exchangeId, creds, kind, account.demoTrading);
          await ex.loadMarkets();
          exchanges.set(kind, ex);
        }
        const fills = await fetchTrades(ex, symbol || undefined, floor ?? baseSince, exchangeId, kind);
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

  // Start a new scan: build the plan (heavy loadMarkets + futures discovery) and
  // return immediately; the client's next call processes the first chunk. This
  // keeps the start call well under the serverless time limit.
  const phase: "full" | "incremental" = account.fullSyncAt ? "incremental" : "full";
  await prisma.exchangeAccount.update({
    where: { id: accountId },
    data: { syncStatus: "syncing", syncPhase: phase, syncError: null, syncCursor: 0, syncImported: 0 },
  });

  // Refresh the account balance (deposit) for the risk manager / capital field.
  try {
    const kind: MarketKind = account.marketType === "spot" ? "spot" : "swap";
    const bal = await fetchBalanceUsdt(
      account.exchange as ExchangeId,
      credsFor(account),
      kind,
      account.demoTrading,
    );
    if (bal != null) {
      await prisma.exchangeAccount.update({
        where: { id: accountId },
        data: { balance: bal, balanceAt: new Date() },
      });
    }
  } catch {
    // balance is best-effort; never fail the sync over it
  }

  const diag: string[] = [];
  let plan: string[];
  try {
    plan = await buildPlan(
      account.exchange as ExchangeId,
      account.marketType,
      phase,
      credsFor(account),
      accountId,
      diag,
      account.demoTrading,
    );
  } catch (err) {
    await prisma.exchangeAccount.update({
      where: { id: accountId },
      data: { syncStatus: "error", syncError: (err as Error).message, syncPhase: null },
    });
    return { status: "error", phase: null, done: 0, total: 0, imported: 0, error: (err as Error).message };
  }

  if (plan.length === 0) {
    // No tasks usually means loadMarkets/income failed (e.g. exchange blocked
    // the server IP). Surface the reason instead of silently completing.
    const why = diag.join(" | ") || "no tradable pairs found";
    await prisma.exchangeAccount.update({
      where: { id: accountId },
      data: {
        syncStatus: "error",
        syncError: why,
        syncPlan: null,
        syncCursor: 0,
        syncTotal: 0,
        syncImported: 0,
        syncPhase: null,
        lastSyncAt: new Date(),
      },
    });
    return { status: "error", phase, done: 0, total: 0, imported: 0, error: why };
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
