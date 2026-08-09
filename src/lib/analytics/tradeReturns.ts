// Доходности сделок для Monte Carlo — одна колонка netPnl из БД.
//
// Раньше симуляция шла в браузере, и ради неё /api/stats отдавал туда весь
// массив сделок: из каждой использовался ровно один netPnl.
//
// Отдельным модулем (а не внутри роута), потому что роут нельзя вызвать вне
// HTTP-контекста — getAuthUser читает cookies, — а SQL надо проверять на
// живой БД. Тот же приём, что в lib/analytics/playbookStats.ts.

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

// market: all | spot | futures | forex — routing тот же, что в /api/stats.
export async function tradeNetPnls(
  userId: string,
  accountId: string,
  market: string,
): Promise<number[]> {
  const accounts = await prisma.exchangeAccount.findMany({
    where: { userId },
    select: { id: true },
  });
  const ownedIds = accounts.map((a) => a.id);
  const ids = accountId !== "all" && ownedIds.includes(accountId) ? [accountId] : ownedIds;
  if (ids.length === 0) return [];
  const inIds = Prisma.join(ids);

  const includeCrypto = market !== "forex";
  const includeImported = market === "all" || market === "forex";
  const marketFilter =
    market === "spot"
      ? Prisma.sql`AND "market" = 'spot'`
      : market === "futures"
        ? Prisma.sql`AND "market" IN ('swap', 'future')`
        : Prisma.empty;

  const crypto = includeCrypto
    ? Prisma.sql`SELECT "netPnl" FROM "Trade" WHERE "accountId" IN (${inIds}) ${marketFilter}`
    : null;
  const imported = includeImported
    ? Prisma.sql`SELECT "netPnl" FROM "ImportedTrade" WHERE "accountId" IN (${inIds})`
    : null;

  const query =
    crypto && imported
      ? Prisma.sql`${crypto} UNION ALL ${imported}`
      : (crypto ?? imported);
  if (!query) return [];

  const rows = await prisma.$queryRaw<{ netPnl: number }[]>`${query}`;
  return rows.map((r) => r.netPnl);
}
