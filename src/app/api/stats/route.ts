import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { reconstructTrades } from "@/lib/analytics/positions";
import { computeMetrics } from "@/lib/analytics/metrics";
import type { RoundTripTrade, TradeSide } from "@/lib/analytics/types";
import {
  parseOptions,
  DEFAULT_ENTRY_POINTS,
  DEFAULT_ENTRY_TYPES,
  DEFAULT_MISTAKES,
  DEFAULT_PATTERNS,
} from "@/lib/annotations";
import { canonSymbol } from "@/lib/format";
import { getCached, setCached, statsVersion } from "@/lib/statsCache";
import type { Prisma } from "@prisma/client";

// Дорогая часть stats — загрузка филлов и реконструкция сделок. Кэшируем именно
// её (BaseData) по ключу юзер+версия+аккаунт+рынок; дешёвые фильтры (символ,
// даты, теги) и метрики считаются поверх кэша на каждый запрос. Раньше кэш был
// по полной комбинации фильтров — каждая комбинация давала отдельный полный
// пересчёт и отдельную копию payload в памяти.
type BaseData = {
  trades: RoundTripTrade[]; // crypto + imported, с приклеенными аннотациями
  fillCount: number;
  symbols: string[];
  accounts: { id: string; label: string; exchange: string; balance: number | null }[];
  entryPointOptions: string[];
  entryTypeOptions: string[];
  mistakeOptions: string[];
  patternOptions: string[];
};

async function buildBase(
  userId: string,
  accountId: string,
  market: string,
): Promise<BaseData> {
  // Restrict to accounts owned by this user.
  const accounts = await prisma.exchangeAccount.findMany({
    where: { userId },
    select: { id: true, label: true, exchange: true, balance: true },
  });
  const ownedIds = new Set(accounts.map((a) => a.id));

  const where: Prisma.FillWhereInput = {
    account: { userId },
  };
  if (accountId !== "all" && ownedIds.has(accountId)) {
    where.accountId = accountId;
  }
  if (market === "spot") where.market = "spot";
  else if (market === "futures") where.market = { in: ["swap", "future"] };
  // Symbol is filtered post-merge by canonical form (so "BTC/USDT" and
  // "BTCUSDT" collapse to one), not via the raw-symbol SQL where.
  // Note: date range is applied to reconstructed trades (by exit time) later,
  // not to fills — otherwise positions opened before the range get truncated.

  // Crypto fills (reconstructed) vs. forex imported trades (taken as-is). The
  // market filter routes between them: spot/futures = crypto only, forex =
  // imported only, all = both.
  const includeCrypto = market !== "forex";
  const includeImported = market === "all" || market === "forex";

  // select ровно под FillInput: без него Prisma тянет все колонки (id, cost,
  // orderId, createdAt…) — на десятках тысяч филлов это лишние мегабайты.
  const fills = includeCrypto
    ? await prisma.fill.findMany({
        where,
        orderBy: { timestamp: "asc" },
        select: {
          symbol: true,
          base: true,
          quote: true,
          market: true,
          side: true,
          price: true,
          amount: true,
          fee: true,
          feeCurrency: true,
          timestamp: true,
          exchange: true,
          accountId: true,
        },
      })
    : [];

  const cryptoTrades = reconstructTrades(fills);

  // Imported (forex / MetaTrader) closed round-trips — money taken as-is.
  const importedWhere: Prisma.ImportedTradeWhereInput = {
    account: { userId },
  };
  if (accountId !== "all" && ownedIds.has(accountId)) importedWhere.accountId = accountId;
  const importedRows = includeImported
    ? await prisma.importedTrade.findMany({ where: importedWhere, orderBy: { exitTime: "asc" } })
    : [];
  const importedTrades: RoundTripTrade[] = importedRows.map((it) => ({
    id: `${it.accountId}:${it.externalId}`,
    symbol: it.symbol,
    base: it.base,
    quote: it.quote,
    market: it.market,
    exchange: it.source,
    accountId: it.accountId,
    side: it.side as TradeSide,
    entryTime: it.entryTime,
    exitTime: it.exitTime,
    durationMs: it.exitTime.getTime() - it.entryTime.getTime(),
    qty: it.qty,
    entryPrice: it.entryPrice,
    exitPrice: it.exitPrice,
    grossPnl: it.grossProfit + it.swap,
    fees: it.commission,
    netPnl: it.netPnl,
    returnPct: 0, // price-based % is wrong-currency for forex; use pips / R instead
    fillCount: 1,
    result: it.netPnl > 1e-9 ? "win" : it.netPnl < -1e-9 ? "loss" : "breakeven",
    lots: it.lots,
    pips: it.pips,
    swap: it.swap,
    commission: it.commission,
    assetClass: "forex",
    accountCurrency: it.currency,
    stopLoss: it.stopLoss,
  }));

  const trades = [...cryptoTrades, ...importedTrades].sort(
    (a, b) => a.exitTime.getTime() - b.exitTime.getTime(),
  );

  // Attach manual annotations (ТВХ / тип входа) to the reconstructed trades.
  // Аннотаций у юзера немного — тянем все по userId вместо гигантского
  // `tradeKey IN (…тысячи ключей…)`.
  const [userRow, annotations] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        entryPointOptions: true,
        entryTypeOptions: true,
        mistakeOptions: true,
        patternOptions: true,
      },
    }),
    prisma.tradeAnnotation.findMany({ where: { userId } }),
  ]);
  const annMap = new Map(annotations.map((a) => [a.tradeKey, a]));
  for (const t of trades) {
    const a = annMap.get(t.id);
    t.entryPoint = a?.entryPoint ?? null;
    t.entryType = a?.entryType ?? null;
    t.mistake = a?.mistake ?? null;
    t.pattern = a?.pattern ?? null;
    // Keep the imported S/L (from the MT report) unless the user overrode it.
    t.stopLoss = a?.stopLoss ?? t.stopLoss ?? null;
    t.note = a?.note ?? null;
  }

  const allSymbols = Array.from(
    new Set([
      ...fills.map((f) => canonSymbol(f.symbol)),
      ...importedRows.map((r) => canonSymbol(r.symbol)),
    ]),
  ).sort();

  return {
    trades,
    fillCount: fills.length,
    symbols: allSymbols,
    accounts,
    entryPointOptions: parseOptions(userRow?.entryPointOptions, DEFAULT_ENTRY_POINTS),
    entryTypeOptions: parseOptions(userRow?.entryTypeOptions, DEFAULT_ENTRY_TYPES),
    mistakeOptions: parseOptions(userRow?.mistakeOptions, DEFAULT_MISTAKES),
    patternOptions: parseOptions(userRow?.patternOptions, DEFAULT_PATTERNS),
  };
}

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId") ?? "all";
  const market = url.searchParams.get("market") ?? "all"; // all | spot | futures
  const symbol = url.searchParams.get("symbol") ?? "all";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const entryPoint = url.searchParams.get("entryPoint") ?? "all";
  const entryType = url.searchParams.get("entryType") ?? "all";
  const mistake = url.searchParams.get("mistake") ?? "all";
  const pattern = url.searchParams.get("pattern") ?? "all";
  const initialCapital = Number(url.searchParams.get("initialCapital") ?? "10000");

  try {
    // Кэш тяжёлой базы: юзер + версия его данных (любая запись бампает версию,
    // и старые entries просто перестают находиться) + фильтры уровня выборки.
    const baseKey = JSON.stringify([
      "base", user.userId, statsVersion(user.userId), accountId, market,
    ]);
    let base = getCached<BaseData>(baseKey);
    if (!base) {
      base = await buildBase(user.userId, accountId, market);
      setCached(baseKey, base);
    }

    // Date range: keep trades CLOSED within [from, to] (exit time).
    let filteredTrades = base.trades;
    const fromMs = from ? new Date(from).getTime() : null;
    const toMs = to ? new Date(to).getTime() : null;
    if (fromMs != null || toMs != null) {
      filteredTrades = filteredTrades.filter((t) => {
        const x = t.exitTime.getTime();
        if (fromMs != null && x < fromMs) return false;
        if (toMs != null && x > toMs) return false;
        return true;
      });
    }
    if (symbol !== "all") {
      filteredTrades = filteredTrades.filter((t) => canonSymbol(t.symbol) === symbol);
    }
    if (entryPoint !== "all") {
      filteredTrades = filteredTrades.filter((t) =>
        entryPoint === "__unset__" ? !t.entryPoint : t.entryPoint === entryPoint,
      );
    }
    if (entryType !== "all") {
      filteredTrades = filteredTrades.filter((t) =>
        entryType === "__unset__" ? !t.entryType : t.entryType === entryType,
      );
    }
    if (mistake !== "all") {
      filteredTrades = filteredTrades.filter((t) =>
        mistake === "__unset__" ? !t.mistake : t.mistake === mistake,
      );
    }
    if (pattern !== "all") {
      filteredTrades = filteredTrades.filter((t) =>
        pattern === "__unset__" ? !t.pattern : t.pattern === pattern,
      );
    }

    const metrics = computeMetrics(
      filteredTrades,
      Number.isFinite(initialCapital) && initialCapital > 0 ? initialCapital : 10000,
    );

    // Serialize trades (Dates -> ISO) for the client table.
    const serializedTrades = filteredTrades.map((t) => ({
      ...t,
      entryPoint: t.entryPoint ?? null,
      entryType: t.entryType ?? null,
      mistake: t.mistake ?? null,
      stopLoss: t.stopLoss ?? null,
      note: t.note ?? null,
      entryTime: t.entryTime.toISOString(),
      exitTime: t.exitTime.toISOString(),
    }));

    const payload = {
      metrics,
      trades: serializedTrades,
      fillCount: base.fillCount,
      symbols: base.symbols,
      accounts: base.accounts,
      entryPointOptions: base.entryPointOptions,
      entryTypeOptions: base.entryTypeOptions,
      mistakeOptions: base.mistakeOptions,
      patternOptions: base.patternOptions,
    };
    return NextResponse.json(payload);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
