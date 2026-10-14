// Статистика по каждому (паттерн, ТВХ) — одним агрегатом в Postgres.
//
// Раньше страница «Плейбуки» тянула /api/stats?accountId=all, то есть ВСЮ
// историю сделок пользователя в браузер, и там фильтровала её по паттерну.
// Нужны из неё три числа на плейбук, поэтому считаем их в БД.
//
// Живёт отдельным модулем, а не внутри роута: роут нельзя вызвать вне
// HTTP-контекста (getAuthUser читает cookies), а проверять SQL на живой БД надо.

import { prisma } from "@/lib/db";
import { markedByJoin, moneyResultSql, resultSql } from "./breakeven";
import { Prisma } from "@prisma/client";

export type PlaybookStatRow = {
  pattern: string;
  entryPoint: string;
  trades: number;
  winRate: number;
  netPnl: number;
};

// Аннотации (паттерн/ТВХ) лежат в TradeAnnotation и клеятся к сделке по
// tradeKey: у крипты это Trade.id, у импортированных — "accountId:externalId"
// (см. lib/analytics/tradeList.ts).
export async function playbookStats(userId: string): Promise<PlaybookStatRow[]> {
  const accounts = await prisma.exchangeAccount.findMany({
    where: { userId },
    select: { id: true },
  });
  const ids = accounts.map((a) => a.id);
  if (ids.length === 0) return [];
  const inIds = Prisma.join(ids);

  const rows = await prisma.$queryRaw<
    {
      pattern: string;
      entryPoint: string;
      trades: number;
      wins: number;
      losses: number;
      netPnl: number;
    }[]
  >`
    SELECT a."pattern" AS pattern,
           COALESCE(NULLIF(a."entryPoint", ''), '') AS "entryPoint",
           COUNT(*)::int AS trades,
           COUNT(*) FILTER (WHERE t.result = 'win')::int AS wins,
           COUNT(*) FILTER (WHERE t.result = 'loss')::int AS losses,
           COALESCE(SUM(t."netPnl"), 0)::float8 AS "netPnl"
    FROM (
      SELECT c."id", c."netPnl", ${resultSql(Prisma.sql`c."result"`, markedByJoin("ca"))}
      FROM "Trade" AS c
      LEFT JOIN "TradeAnnotation" AS ca
        ON ca."tradeKey" = c."id" AND ca."userId" = ${userId}
      WHERE c."accountId" IN (${inIds})
      UNION ALL
      SELECT i."accountId" || ':' || i."externalId", i."netPnl",
             ${resultSql(moneyResultSql("i"), markedByJoin("ia"))}
      FROM "ImportedTrade" AS i
      LEFT JOIN "TradeAnnotation" AS ia
        ON ia."tradeKey" = i."accountId" || ':' || i."externalId" AND ia."userId" = ${userId}
      WHERE i."accountId" IN (${inIds}) AND i."groupId" IS NULL
    ) AS t
    JOIN "TradeAnnotation" a ON a."tradeKey" = t."id" AND a."userId" = ${userId}
    WHERE a."pattern" IS NOT NULL AND a."pattern" <> ''
    GROUP BY a."pattern", COALESCE(NULLIF(a."entryPoint", ''), '')
  `;
  return rows.map((r) => ({
    pattern: r.pattern,
    entryPoint: r.entryPoint,
    trades: r.trades,
    // Безубытки вне знаменателя — как и на дашборде (lib/analytics/metrics.ts).
    winRate: r.wins + r.losses > 0 ? (r.wins / (r.wins + r.losses)) * 100 : 0,
    netPnl: r.netPnl,
  }));
}
