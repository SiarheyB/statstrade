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
import { recomputeRRForAccount } from "./rr";

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
  // deleteMany+createMany обнуляет rr на пересобранных строках — досчитываем
  // сразу же, иначе Сделки/Календарь показывали бы пусто до следующего
  // изменения stopLoss/риск-профиля.
  await recomputeRRForAccount(accountId);
}

/**
 * Полная пересборка аккаунта + отметка tradesRebuiltAt (бэкафилл, демо-данные).
 *
 * Идёт ПО ГРУППАМ (пара + рынок), а не одной выборкой. Раньше сюда поднимались
 * ВСЕ филлы аккаунта разом: на активном счёте это сотни тысяч строк в куче
 * Node, и всё это внутри HTTP-запроса — ensureAccountTrades вызывается прямо
 * из /api/stats, /api/trades и /api/risk. Именно этот сценарий записан в
 * docker-compose.prod.yml как причина поднять mem_limit приложения до 3584m.
 *
 * Реконструкция независима по группам (см. rebuildTradeGroups), поэтому
 * результат тот же, а в памяти одновременно живёт одна пара.
 *
 * Атомарности на весь аккаунт больше нет, и это допустимо: пересборка
 * самовосстанавливающаяся. Упала на середине — tradesRebuiltAt остался NULL,
 * следующий запрос начнёт заново, а начинается она со сноса всех строк счёта.
 */
export async function rebuildAccountTrades(accountId: string): Promise<void> {
  const groups = await prisma.fill.groupBy({
    by: ["symbol", "market"],
    where: { accountId },
  });

  // Сносим ВСЕ строки счёта, а не только пересобираемые группы: у группы,
  // где филлов уже не осталось (откат импорта), иначе повисли бы старые сделки.
  await prisma.trade.deleteMany({ where: { accountId } });

  for (const g of groups) {
    const fills = await prisma.fill.findMany({
      where: { accountId, symbol: g.symbol, market: g.market },
      orderBy: { timestamp: "asc" },
      select: FILL_SELECT,
    });
    const trades = reconstructTrades(fills);
    if (trades.length) {
      await prisma.trade.createMany({ data: trades.map(toRow), skipDuplicates: true });
    }
  }

  await prisma.exchangeAccount.update({
    where: { id: accountId },
    data: { tradesRebuiltAt: new Date() },
  });
  // Один раз на весь счёт, а не на каждую группу.
  await recomputeRRForAccount(accountId);
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
