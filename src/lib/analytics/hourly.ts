// Почасовые агрегаты по закрытым сделкам (таблица TradeHourly).
//
// Зачем: риск-менеджер и дашборд считали суммы за период, вытаскивая ВСЕ сделки
// за окно в Node и складывая их там. Суммы детерминированы и меняются только
// вместе с самими сделками, поэтому считаем их один раз — при изменении сделок —
// и дальше просто читаем.
//
// Считается целиком в Postgres (DELETE + INSERT…SELECT в одной транзакции):
// строки в Node не переносятся вообще. Строк на аккаунт — по числу торговых
// часов, поэтому полная пересборка аккаунта дешёвая; для правки одной сделки
// есть вариант с пересборкой одного часа.
//
// Бакет = начало часа exitTime в UTC. Колонки exitTime имеют тип TIMESTAMP(3)
// БЕЗ таймзоны и хранят UTC, поэтому date_trunc('hour', "exitTime") — это ровно
// UTC-час (AT TIME ZONE здесь применять НЕЛЬЗЯ: он превратит значение в
// timestamptz и результат поедет по таймзоне сессии).
//
// Почему час, а не день: все экраны показывают время в таймзоне пользователя,
// а дневной агрегат в UTC в неё не пересобирается (один UTC-день попадает на
// два локальных). Часы складываются в локальный день при чтении — см.
// bucketByLocalDay() в lib/analytics/periods.ts.
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
function sourceRows(accountId: string, hourFilter: Prisma.Sql) {
  return Prisma.sql`
    SELECT "accountId", "exitTime", "netPnl", "fees", "result", "rr"
    FROM "Trade"
    WHERE "accountId" = ${accountId} ${hourFilter}
    UNION ALL
    SELECT "accountId", "exitTime", "netPnl", "commission" AS "fees",
           CASE
             WHEN "netPnl" > 1e-9 THEN 'win'
             WHEN "netPnl" < -1e-9 THEN 'loss'
             ELSE 'breakeven'
           END AS "result",
           "rr"
    FROM "ImportedTrade"
    WHERE "accountId" = ${accountId} ${hourFilter}
  `;
}

async function rebuild(accountId: string, hour: Date | null): Promise<void> {
  // Границы часа фильтруем по самому exitTime (а не по date_trunc), чтобы
  // Postgres мог использовать индекс [accountId, exitTime] вместо вычисления
  // выражения по всем строкам аккаунта.
  const hourFilter = hour
    ? Prisma.sql`AND "exitTime" >= ${hour} AND "exitTime" < ${new Date(hour.getTime() + 3_600_000)}`
    : Prisma.empty;
  const deleteFilter = hour ? Prisma.sql`AND "hour" = ${hour}` : Prisma.empty;

  await prisma.$transaction([
    prisma.$executeRaw`
      DELETE FROM "TradeHourly" WHERE "accountId" = ${accountId} ${deleteFilter}
    `,
    prisma.$executeRaw`
      INSERT INTO "TradeHourly" (
        "accountId", "hour", "trades", "wins", "losses", "netPnl",
        "grossProfit", "grossLoss", "fees", "winR", "lossR", "rTrades", "updatedAt"
      )
      SELECT "accountId",
             date_trunc('hour', "exitTime") AS hour,
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
      FROM (${sourceRows(accountId, hourFilter)}) AS src
      GROUP BY "accountId", date_trunc('hour', "exitTime")
    `,
  ]);
}

// Полная пересборка почасовых агрегатов аккаунта. Удаление + вставка, поэтому
// исчезнувшие часы (сделки удалены/перезалиты) тоже подчищаются.
export async function rebuildTradeHourly(accountId: string): Promise<void> {
  await rebuild(accountId, null);
}

// Пересборка ОДНОГО часа — для правки одной сделки (аннотация/стоп), чтобы не
// перетряхивать всю историю аккаунта на каждое сохранение.
export async function rebuildTradeHourlyForTrade(accountId: string, exitTime: Date): Promise<void> {
  const hour = new Date(Date.UTC(
    exitTime.getUTCFullYear(),
    exitTime.getUTCMonth(),
    exitTime.getUTCDate(),
    exitTime.getUTCHours(),
  ));
  await rebuild(accountId, hour);
}

// Бэкафилл для аккаунтов, у которых сделки есть, а агрегатов ещё нет (первый
// запуск после миграции). Тот же паттерн, что backfillMissingRR: после первого
// прогона запрос ничего не находит, поэтому вызывать на каждый старт безопасно.
export async function backfillMissingTradeHourly(): Promise<{ accounts: number }> {
  const [crypto, imported, existing] = await Promise.all([
    prisma.trade.findMany({ select: { accountId: true }, distinct: ["accountId"] }),
    prisma.importedTrade.findMany({ select: { accountId: true }, distinct: ["accountId"] }),
    prisma.tradeHourly.findMany({ select: { accountId: true }, distinct: ["accountId"] }),
  ]);
  const done = new Set(existing.map((r) => r.accountId));
  const todo = new Set(
    [...crypto, ...imported].map((r) => r.accountId).filter((id) => !done.has(id)),
  );
  for (const id of todo) {
    await rebuildTradeHourly(id).catch(() => {});
  }
  return { accounts: todo.size };
}
