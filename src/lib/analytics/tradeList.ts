// Постраничная выборка сделок для /dashboard/trades.
//
// Зачем отдельно от /api/stats: страница «Сделки» не использует НИ ОДНОЙ метрики
// из него — только сам список, счета и словари тегов. При этом /api/stats на
// каждый её заход считал ~60 метрик, кривую капитала и десяток разрезов, а потом
// отдавал в браузер всю историю сделок целиком, чтобы показать 25 строк.
//
// Здесь фильтрация, сортировка и пагинация делаются в Postgres. Crypto (Trade) и
// импортированные форекс/MT-сделки (ImportedTrade) сводятся одним UNION ALL —
// тот же приём, что в lib/analytics/daily.ts. Соответствия полей повторяют
// buildBase() из /api/stats, чтобы обе выдачи описывали сделку одинаково.

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { SerializedTrade } from "@/lib/types";
import type { TradeResult, TradeSide } from "@/lib/analytics/types";

export const TRADE_SORTS = [
  "entryTime", "exitTime", "netPnl", "returnPct", "durationMs", "fees",
] as const;
export type TradeSort = (typeof TRADE_SORTS)[number];

export type TradeFilters = {
  accountId: string; // "all" | id счёта
  symbol: string; // "all" | канонический тикер (BTCUSDT)
  market: string; // all | spot | futures | forex
  side: string; // all | long | short
  result: string; // all | win | loss | breakeven
  entryPoint: string; // all | __unset__ | значение
  entryType: string;
  mistake: string;
  pattern: string;
  // Окно по времени ВЫХОДА (ISO или null). Используется «Календарём» для
  // списка сделок выбранного дня: границы локальных суток он считает сам.
  from?: string | null;
  to?: string | null;
};

export const UNSET = "__unset__";

// Канонический тикер средствами SQL — точная копия canonSymbol() из lib/format.ts
// ("BTC/USDT:USDT" → "BTCUSDT"), чтобы фильтр по символу отрабатывал в БД, а не
// после выгрузки строк.
const CANON_SYMBOL = Prisma.sql`UPPER(REPLACE(SPLIT_PART(t."symbol", ':', 1), '/', ''))`;

// Колонка сортировки. Значение приходит из query-параметра, поэтому берётся
// строго из белого списка — в SQL не подставляется ничего пользовательского.
const SORT_SQL: Record<TradeSort, Prisma.Sql> = {
  entryTime: Prisma.sql`t."entryTime"`,
  exitTime: Prisma.sql`t."exitTime"`,
  netPnl: Prisma.sql`t."netPnl"`,
  returnPct: Prisma.sql`t."returnPct"`,
  fees: Prisma.sql`t."fees"`,
  durationMs: Prisma.sql`(t."exitTime" - t."entryTime")`,
};

type Row = {
  id: string;
  symbol: string;
  base: string;
  quote: string;
  market: string;
  exchange: string;
  accountId: string;
  side: string;
  entryTime: Date;
  exitTime: Date;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  returnPct: number;
  fillCount: number;
  result: string;
  rr: number | null;
  lots: number | null;
  pips: number | null;
  swap: number | null;
  commission: number | null;
  assetClass: string | null;
  accountCurrency: string | null;
  stopLoss: number | null;
};

// Обе таблицы сделок в одной форме. Приведения типов обязательны: у NULL-колонок
// Postgres иначе не выведет тип и UNION ALL не сойдётся.
function sourceRows(accountIds: string[]): Prisma.Sql {
  const ids = Prisma.join(accountIds);
  return Prisma.sql`
    SELECT "id", "symbol", "base", "quote", "market", "exchange", "accountId",
           "side", "entryTime", "exitTime", "qty", "entryPrice", "exitPrice",
           "grossPnl", "fees", "netPnl", "returnPct", "fillCount", "result", "rr",
           NULL::float8 AS "lots", NULL::float8 AS "pips", NULL::float8 AS "swap",
           NULL::float8 AS "commission", NULL::text AS "assetClass",
           NULL::text AS "accountCurrency", NULL::float8 AS "stopLoss"
    FROM "Trade"
    WHERE "accountId" IN (${ids})
    UNION ALL
    SELECT "accountId" || ':' || "externalId", "symbol", "base", "quote", "market",
           "source", "accountId", "side", "entryTime", "exitTime", "qty",
           "entryPrice", "exitPrice", "grossProfit" + "swap", "commission", "netPnl",
           0::float8, 1,
           CASE
             WHEN "netPnl" > 1e-9 THEN 'win'
             WHEN "netPnl" < -1e-9 THEN 'loss'
             ELSE 'breakeven'
           END,
           "rr", "lots", "pips", "swap", "commission", 'forex', "currency", "stopLoss"
    FROM "ImportedTrade"
    WHERE "accountId" IN (${ids})
  `;
}

// Ключи сделок, у которых заданное поле аннотации заполнено (для __unset__) или
// равно конкретному значению. Аннотаций у пользователя немного, поэтому проще
// и дешевле отобрать ключи в Node, чем join'ить таблицу в UNION-запросе.
type AnnField = "entryPoint" | "entryType" | "mistake" | "pattern";
type AnnRow = { tradeKey: string } & Partial<Record<AnnField, string | null>>;

function keysFor(annotations: AnnRow[], field: AnnField, value: string): string[] {
  if (value === UNSET) {
    return annotations.filter((a) => !!a[field]).map((a) => a.tradeKey);
  }
  return annotations.filter((a) => a[field] === value).map((a) => a.tradeKey);
}

export type TradePage = {
  trades: SerializedTrade[];
  total: number;
};

// Список тикеров для фильтра — канонические, отсортированы. Требует прохода по
// сделкам пользователя, поэтому вызывается отдельно и только когда реально нужен
// (см. withMeta в /api/trades), а не на каждое перелистывание страницы.
export async function querySymbols(userId: string): Promise<string[]> {
  const accounts = await prisma.exchangeAccount.findMany({
    where: { userId },
    select: { id: true },
  });
  const ids = accounts.map((a) => a.id);
  if (ids.length === 0) return [];
  const rows = await prisma.$queryRaw<{ symbol: string }[]>`
    SELECT DISTINCT ${CANON_SYMBOL} AS symbol
    FROM (${sourceRows(ids)}) AS t
    ORDER BY symbol ASC
  `;
  return rows.map((r) => r.symbol);
}

export async function queryTrades(
  userId: string,
  filters: TradeFilters,
  sort: TradeSort,
  dir: "asc" | "desc",
  opts: { page: number; pageSize: number } | { all: true },
): Promise<TradePage> {
  const accounts = await prisma.exchangeAccount.findMany({
    where: { userId },
    select: { id: true },
  });
  const ownedIds = accounts.map((a) => a.id);
  const accountIds =
    filters.accountId !== "all" && ownedIds.includes(filters.accountId)
      ? [filters.accountId]
      : ownedIds;
  if (accountIds.length === 0) return { trades: [], total: 0 };

  const annotations = (await prisma.tradeAnnotation.findMany({
    where: { userId },
  })) as unknown as AnnRow[];

  const where: Prisma.Sql[] = [];

  if (filters.symbol !== "all") {
    where.push(Prisma.sql`${CANON_SYMBOL} = ${filters.symbol}`);
  }
  if (filters.market === "spot") {
    where.push(Prisma.sql`t."market" = 'spot'`);
  } else if (filters.market === "futures") {
    where.push(Prisma.sql`t."market" IN ('swap', 'future')`);
  } else if (filters.market === "forex") {
    where.push(Prisma.sql`t."market" IN ('forex', 'metal', 'cfd')`);
  }
  if (filters.side === "long" || filters.side === "short") {
    where.push(Prisma.sql`t."side" = ${filters.side}`);
  }
  if (filters.result === "win" || filters.result === "loss" || filters.result === "breakeven") {
    where.push(Prisma.sql`t."result" = ${filters.result}`);
  }
  const fromDate = filters.from ? new Date(filters.from) : null;
  const toDate = filters.to ? new Date(filters.to) : null;
  if (fromDate && !Number.isNaN(fromDate.getTime())) {
    where.push(Prisma.sql`t."exitTime" >= ${fromDate}`);
  }
  if (toDate && !Number.isNaN(toDate.getTime())) {
    where.push(Prisma.sql`t."exitTime" < ${toDate}`);
  }

  // Фильтры по аннотациям. Конкретное значение → id IN (ключи с этим значением);
  // «не задано» → id NOT IN (ключи, где поле заполнено). Пустой набор ключей при
  // конкретном значении означает «совпадений нет» — сразу отдаём пустую страницу.
  const annFilters: [AnnField, string][] = [
    ["entryPoint", filters.entryPoint],
    ["entryType", filters.entryType],
    ["mistake", filters.mistake],
    ["pattern", filters.pattern],
  ];
  for (const [field, value] of annFilters) {
    if (value === "all") continue;
    const keys = keysFor(annotations, field, value);
    if (value === UNSET) {
      if (keys.length > 0) where.push(Prisma.sql`t."id" NOT IN (${Prisma.join(keys)})`);
    } else {
      if (keys.length === 0) return { trades: [], total: 0 };
      where.push(Prisma.sql`t."id" IN (${Prisma.join(keys)})`);
    }
  }

  const whereSql = where.length
    ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}`
    : Prisma.empty;
  const src = Prisma.sql`(${sourceRows(accountIds)}) AS t`;

  const totalRows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM ${src} ${whereSql}
  `;
  const total = totalRows[0]?.n ?? 0;
  if (total === 0) return { trades: [], total: 0 };

  // Вторичная сортировка по id — чтобы порядок строк с одинаковым ключом был
  // стабильным между страницами (иначе одна сделка могла бы попасть на две
  // страницы сразу, а другая — ни на одну).
  const dirSql = dir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const pageSql =
    "all" in opts
      ? Prisma.empty
      : Prisma.sql`LIMIT ${opts.pageSize} OFFSET ${opts.page * opts.pageSize}`;

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT t.* FROM ${src} ${whereSql}
    ORDER BY ${SORT_SQL[sort]} ${dirSql}, t."id" ASC
    ${pageSql}
  `;

  const annMap = new Map(annotations.map((a) => [a.tradeKey, a]));
  const trades: SerializedTrade[] = rows.map((r) => {
    const a = annMap.get(r.id) as
      | (AnnRow & {
          stopLoss?: number | null;
          note?: string | null;
          imageUrl?: string | null;
          imageProvider?: string | null;
          imagePublicUrl?: string | null;
        })
      | undefined;
    return {
      id: r.id,
      symbol: r.symbol,
      base: r.base,
      quote: r.quote,
      market: r.market,
      exchange: r.exchange,
      accountId: r.accountId,
      side: r.side as TradeSide,
      entryTime: r.entryTime.toISOString(),
      exitTime: r.exitTime.toISOString(),
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
      rr: r.rr,
      entryPoint: a?.entryPoint ?? null,
      entryType: a?.entryType ?? null,
      mistake: a?.mistake ?? null,
      pattern: a?.pattern ?? null,
      // Импортированный S/L (из отчёта MT) действует, пока пользователь не
      // переопределил его вручную — как в /api/stats.
      stopLoss: a?.stopLoss ?? r.stopLoss ?? null,
      note: a?.note ?? null,
      imageUrl: a?.imageUrl ?? null,
      imageProvider: a?.imageProvider ?? null,
      imagePublicUrl: a?.imagePublicUrl ?? null,
      ...(r.lots != null ? { lots: r.lots } : {}),
      ...(r.pips != null ? { pips: r.pips } : {}),
      ...(r.swap != null ? { swap: r.swap } : {}),
      ...(r.commission != null ? { commission: r.commission } : {}),
      ...(r.assetClass ? { assetClass: r.assetClass } : {}),
      ...(r.accountCurrency ? { accountCurrency: r.accountCurrency } : {}),
    };
  });

  return { trades, total };
}
