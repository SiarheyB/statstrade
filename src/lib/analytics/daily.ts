// Дневные агрегаты по закрытым сделкам (таблица TradeDaily).
//
// Зачем: риск-менеджер и дашборд считали суммы за период, вытаскивая ВСЕ сделки
// за окно в Node и складывая их там. Суммы детерминированы и меняются только
// вместе с самими сделками, поэтому считаем их один раз — при изменении сделок —
// и дальше просто читаем.
//
// Считается целиком в Postgres (DELETE + INSERT…SELECT в одной транзакции):
// строки в Node не переносятся вообще. Строк на аккаунт — по числу торговых
// дней, поэтому полная пересборка аккаунта дешёвая; для правки одной сделки
// есть вариант с пересборкой одного дня.
//
// День = дата exitTime в UTC. Колонки exitTime имеют тип TIMESTAMP(3) БЕЗ
// таймзоны и хранят UTC, поэтому "exitTime"::date — это ровно UTC-дата
// (AT TIME ZONE здесь применять НЕЛЬЗЯ: он превратит значение в timestamptz и
// приведение к date поедет по таймзоне сессии).
//
// Точки пересчёта — те же, что у rr (см. lib/analytics/rr.ts): rebuild сделок
// аккаунта, правка stopLoss в аннотации, смена риск-профиля, импорт отчёта.
// Вызовы встроены в recomputeRRForAccount / recomputeRRForTradeKey, потому что
// winR/lossR складываются как раз из сохранённого rr.

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

// Разные модели сделок сводятся к одной форме: crypto (Trade) и импортированные
// форекс/MT (ImportedTrade). Соответствия полей повторяют /api/stats:
// fees = commission, result выводится из знака netPnl с тем же эпсилоном.
function sourceRows(accountId: string, dayFilter: Prisma.Sql) {
  return Prisma.sql`
    SELECT "accountId", "exitTime", "netPnl", "fees", "result", "rr"
    FROM "Trade"
    WHERE "accountId" = ${accountId} ${dayFilter}
    UNION ALL
    SELECT "accountId", "exitTime", "netPnl", "commission" AS "fees",
           CASE
             WHEN "netPnl" > 1e-9 THEN 'win'
             WHEN "netPnl" < -1e-9 THEN 'loss'
             ELSE 'breakeven'
           END AS "result",
           "rr"
    FROM "ImportedTrade"
    WHERE "accountId" = ${accountId} ${dayFilter}
  `;
}

async function rebuild(accountId: string, day: Date | null): Promise<void> {
  // Границы дня фильтруем по самому exitTime (а не по ::date), чтобы Postgres
  // мог использовать индекс [accountId, exitTime] вместо вычисления выражения
  // по всем строкам аккаунта.
  const dayFilter = day
    ? Prisma.sql`AND "exitTime" >= ${day} AND "exitTime" < ${new Date(day.getTime() + 86_400_000)}`
    : Prisma.empty;
  const deleteFilter = day ? Prisma.sql`AND "day" = ${day}` : Prisma.empty;

  await prisma.$transaction([
    prisma.$executeRaw`
      DELETE FROM "TradeDaily" WHERE "accountId" = ${accountId} ${deleteFilter}
    `,
    prisma.$executeRaw`
      INSERT INTO "TradeDaily" (
        "accountId", "day", "trades", "wins", "losses", "netPnl",
        "grossProfit", "grossLoss", "fees", "winR", "lossR", "rTrades", "updatedAt"
      )
      SELECT "accountId",
             "exitTime"::date AS day,
             COUNT(*)::int,
             COUNT(*) FILTER (WHERE "result" = 'win')::int,
             COUNT(*) FILTER (WHERE "result" = 'loss')::int,
             COALESCE(SUM("netPnl"), 0),
             COALESCE(SUM("netPnl") FILTER (WHERE "result" = 'win'), 0),
             COALESCE(-SUM("netPnl") FILTER (WHERE "result" = 'loss'), 0),
             COALESCE(SUM("fees"), 0),
             COALESCE(SUM("rr") FILTER (WHERE "rr" > 0), 0),
             COALESCE(SUM("rr") FILTER (WHERE "rr" < 0), 0),
             COUNT(*) FILTER (WHERE "rr" IS NOT NULL)::int,
             NOW()
      FROM (${sourceRows(accountId, dayFilter)}) AS src
      GROUP BY "accountId", "exitTime"::date
    `,
  ]);
}

// Полная пересборка дневных агрегатов аккаунта. Удаление + вставка, поэтому
// исчезнувшие дни (сделки удалены/перезалиты) тоже подчищаются.
export async function rebuildTradeDaily(accountId: string): Promise<void> {
  await rebuild(accountId, null);
}

// Пересборка ОДНОГО дня — для правки одной сделки (аннотация/стоп), чтобы не
// перетряхивать всю историю аккаунта на каждое сохранение.
export async function rebuildTradeDailyForDay(accountId: string, exitTime: Date): Promise<void> {
  const day = new Date(Date.UTC(
    exitTime.getUTCFullYear(),
    exitTime.getUTCMonth(),
    exitTime.getUTCDate(),
  ));
  await rebuild(accountId, day);
}

// Бэкафилл для аккаунтов, у которых сделки есть, а агрегатов ещё нет (первый
// запуск после миграции). Тот же паттерн, что backfillMissingRR: после первого
// прогона запрос ничего не находит, поэтому вызывать на каждый старт безопасно.
export async function backfillMissingTradeDaily(): Promise<{ accounts: number }> {
  const [crypto, imported, existing] = await Promise.all([
    prisma.trade.findMany({ select: { accountId: true }, distinct: ["accountId"] }),
    prisma.importedTrade.findMany({ select: { accountId: true }, distinct: ["accountId"] }),
    prisma.tradeDaily.findMany({ select: { accountId: true }, distinct: ["accountId"] }),
  ]);
  const done = new Set(existing.map((r) => r.accountId));
  const todo = new Set(
    [...crypto, ...imported].map((r) => r.accountId).filter((id) => !done.has(id)),
  );
  for (const id of todo) {
    await rebuildTradeDaily(id).catch(() => {});
  }
  return { accounts: todo.size };
}
