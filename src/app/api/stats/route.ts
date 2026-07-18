import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { ensureAccountTrades } from "@/lib/analytics/materialize";
import { computeMetrics } from "@/lib/analytics/metrics";
import type { RoundTripTrade, TradeResult, TradeSide } from "@/lib/analytics/types";
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
  fromMs: number | null,
  toMs: number | null,
): Promise<BaseData> {
  // Restrict to accounts owned by this user.
  const accountRows = await prisma.exchangeAccount.findMany({
    where: { userId },
    select: { id: true, label: true, exchange: true, balance: true, tradesRebuiltAt: true },
  });
  // Бэкафилл материализованных сделок для аккаунтов, где он ещё не выполнялся
  // (первый запрос после деплоя / legacy). Одноразово на аккаунт.
  await ensureAccountTrades(accountRows);
  const accounts = accountRows.map(({ id, label, exchange, balance }) => ({
    id, label, exchange, balance,
  }));
  const ownedIds = new Set(accounts.map((a) => a.id));

  const where: Prisma.TradeWhereInput = {
    account: { userId },
  };
  if (accountId !== "all" && ownedIds.has(accountId)) {
    where.accountId = accountId;
  }
  if (market === "spot") where.market = "spot";
  else if (market === "futures") where.market = { in: ["swap", "future"] };
  if (fromMs != null || toMs != null) {
    const exitTime: Prisma.DateTimeFilter = {};
    if (fromMs != null) exitTime.gte = new Date(fromMs);
    if (toMs != null) exitTime.lte = new Date(toMs);
    where.exitTime = exitTime;
  }
  // Symbol is filtered post-merge by canonical form (so "BTC/USDT" and
  // "BTCUSDT" collapse to one), not via the raw-symbol SQL where.

  // Материализованные крипто-сделки (Trade) vs. forex imported trades (taken
  // as-is). The market filter routes between them: spot/futures = crypto only,
  // forex = imported only, all = both.
  const includeCrypto = market !== "forex";
  const includeImported = market === "all" || market === "forex";

  const tradeRows = includeCrypto
    ? await prisma.trade.findMany({ where, orderBy: { exitTime: "asc" } })
    : [];
  const cryptoTrades: RoundTripTrade[] = tradeRows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    base: r.base,
    quote: r.quote,
    market: r.market,
    exchange: r.exchange,
    accountId: r.accountId,
    side: r.side as TradeSide,
    entryTime: r.entryTime,
    exitTime: r.exitTime,
    durationMs: r.exitTime.getTime() - r.entryTime.getTime(),
    qty: r.qty,
    entryPrice: r.entryPrice,
    exitPrice: r.exitPrice,
    grossPnl: r.grossPnl,
    fees: r.fees,
    netPnl: r.netPnl,
    returnPct: r.returnPct,
    fillCount: r.fillCount,
    result: r.result as TradeResult,
  }));

  // Счётчик филлов для шапки («N trades · M fills») — лёгкий COUNT по индексу.
  const fillWhere: Prisma.FillWhereInput = { account: { userId } };
  if (accountId !== "all" && ownedIds.has(accountId)) fillWhere.accountId = accountId;
  if (market === "spot") fillWhere.market = "spot";
  else if (market === "futures") fillWhere.market = { in: ["swap", "future"] };
  const fillCount = includeCrypto ? await prisma.fill.count({ where: fillWhere }) : 0;

  // Imported (forex / MetaTrader) closed round-trips — money taken as-is.
  const importedWhere: Prisma.ImportedTradeWhereInput = {
    account: { userId },
  };
  if (accountId !== "all" && ownedIds.has(accountId)) importedWhere.accountId = accountId;
  if (fromMs != null || toMs != null) {
    const exitTime: Prisma.DateTimeFilter = {};
    if (fromMs != null) exitTime.gte = new Date(fromMs);
    if (toMs != null) exitTime.lte = new Date(toMs);
    importedWhere.exitTime = exitTime;
  }
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
      ...cryptoTrades.map((t) => canonSymbol(t.symbol)),
      ...importedRows.map((r) => canonSymbol(r.symbol)),
    ]),
  ).sort();

  return {
    trades,
    fillCount,
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

  // Date range (ms) — вычисляем до кэша, чтобы фильтровать на уровне SQL.
  const fromMs = from ? new Date(from).getTime() : null;
  const toMs = to ? new Date(to).getTime() : null;

  try {
    // Кэш тяжёлой базы: юзер + версия его данных (любая запись бампает версию,
    // и старые entries просто перестают находиться) + фильтры уровня выборки.
    // Дата-диапазон тоже часть ключа: при выборе "7d" / "30d" / "90d" на дашборде
    // кэшируем только эти сделки, а не весь портфель — холодный старт быстрее.
    const baseKey = JSON.stringify([
      "base", user.userId, statsVersion(user.userId), accountId, market, from, to,
    ]);
    let base = getCached<BaseData>(baseKey);
    if (!base) {
      base = await buildBase(user.userId, accountId, market, fromMs, toMs);
      setCached(baseKey, base);
    }

    // Date range: keep trades CLOSED within [from, to] (exit time).
    // Фильтр уже применён на уровне SQL в buildBase(), но дублируем здесь
    // для подстраховки (если кэш вернул данные без этого фильтра из-за
    // смены версии ключа — см. statsVersion).
    let filteredTrades = base.trades;
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
