// Материализация round-trip сделок (таблица Trade) из филлов.
//
// Реконструкция детерминирована и независима по группам (account+symbol+market),
// поэтому после вставки новых филлов достаточно пересобрать только затронутые
// группы: удалить их строки Trade и вставить свежие. Группа — это филлы одной
// пары (сотни-тысячи строк), пересборка дешёвая. Полная пересборка аккаунта
// (rebuildAccountTrades) нужна для бэкафилла (tradesRebuiltAt IS NULL) и после
// массовых замен филлов (демо-данные).

import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { reconstructTrades } from "./positions";
import type { RoundTripTrade } from "./types";

export type TradeGroup = { symbol: string; market: string };

// select ровно под FillInput (см. types.ts).
const FILL_SELECT = {
  symbol: true,
  base: true,
  quote: true,
  market: true,
  side: true,
  price: true,
  amount: true,
  fee: true,
  feeCurrency: true,
  realizedPnl: true,
  timestamp: true,
  exchange: true,
  accountId: true,
} as const;

function toRow(t: RoundTripTrade): Prisma.TradeCreateManyInput {
  return {
    id: t.id,
    accountId: t.accountId,
    symbol: t.symbol,
    base: t.base,
    quote: t.quote,
    market: t.market,
    exchange: t.exchange,
    side: t.side,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    qty: t.qty,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    grossPnl: t.grossPnl,
    fees: t.fees,
    netPnl: t.netPnl,
    returnPct: t.returnPct,
    fillCount: t.fillCount,
    result: t.result,
  };
}

// Пересобрать сделки заданных групп аккаунта (после вставки новых филлов).
export async function rebuildTradeGroups(
  accountId: string,
  groups: TradeGroup[],
): Promise<void> {
  if (groups.length === 0) return;
  const or = groups.map((g) => ({ symbol: g.symbol, market: g.market }));
  const fills = await prisma.fill.findMany({
    where: { accountId, OR: or },
    orderBy: { timestamp: "asc" },
    select: FILL_SELECT,
  });
  const trades = reconstructTrades(fills);
  await prisma.$transaction([
    prisma.trade.deleteMany({ where: { accountId, OR: or } }),
    ...(trades.length
      ? [prisma.trade.createMany({ data: trades.map(toRow), skipDuplicates: true })]
      : []),
  ]);
}

// Полная пересборка аккаунта + отметка tradesRebuiltAt (бэкафилл, демо-данные).
export async function rebuildAccountTrades(accountId: string): Promise<void> {
  const fills = await prisma.fill.findMany({
    where: { accountId },
    orderBy: { timestamp: "asc" },
    select: FILL_SELECT,
  });
  const trades = reconstructTrades(fills);
  await prisma.$transaction([
    prisma.trade.deleteMany({ where: { accountId } }),
    ...(trades.length
      ? [prisma.trade.createMany({ data: trades.map(toRow), skipDuplicates: true })]
      : []),
    prisma.exchangeAccount.update({
      where: { id: accountId },
      data: { tradesRebuiltAt: new Date() },
    }),
  ]);
}

// Ленивый бэкафилл: пересобрать аккаунты, у которых Trade ещё не строился
// (после деплоя / legacy). Guard от параллельных пересборок в одном процессе.
const rebuilding = new Set<string>();
export async function ensureAccountTrades(
  accounts: { id: string; tradesRebuiltAt: Date | null }[],
): Promise<void> {
  for (const a of accounts) {
    if (a.tradesRebuiltAt || rebuilding.has(a.id)) continue;
    rebuilding.add(a.id);
    try {
      await rebuildAccountTrades(a.id);
    } finally {
      rebuilding.delete(a.id);
    }
  }
}
