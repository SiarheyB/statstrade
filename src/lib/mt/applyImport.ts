import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { bumpStatsVersion } from "@/lib/statsCache";
import { toImportedTrade } from "@/lib/mt/to-imported";
import { diffImport } from "@/lib/mt/reimport";
import { recomputeRRForAccount } from "@/lib/analytics/rr";
import { logger } from "@/lib/logger";
import type { ParsedTrade } from "@/lib/mt/types";

export type ImportAccount = { id: string; source: string; accountCurrency: string };

/**
 * Записать закрытые позиции MetaTrader в аккаунт.
 *
 * Общий путь для ручного импорта HTML-отчёта (/api/accounts/[id]/import) и
 * выгрузки из советника (/api/mt/push): ключ дедупликации один — тикет позиции,
 * поэтому отчёт и советник не задваивают сделки, а дозакрытые позиции
 * обновляются (см. lib/mt/reimport.ts). Партия (importBatch) общая для обоих
 * путей — «Откатить загрузку» откатывает и выгрузку из советника.
 */
export async function applyImport(opts: {
  account: ImportAccount;
  userId: string;
  trades: ParsedTrade[];
  balance: number | null;
  /** Отметить выгрузку из советника (lastPushAt). */
  push?: boolean;
}) {
  const { account, userId, trades, balance } = opts;
  const batch = randomUUID();
  const rows = trades.map((t) => toImportedTrade(t, account, account.source, batch));
  const symbols = Array.from(new Set(rows.map((r) => r.symbol))).sort();
  const times = rows.map((r) => r.exitTime.getTime());
  const dateRange = rows.length
    ? { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) }
    : null;
  const netTotal = rows.reduce((s, r) => s + r.netPnl, 0);
  const deposit = balance != null ? Math.round((balance - netTotal) * 100) / 100 : null;

  // Знакомые тикеты не пропускаем, а сравниваем с тем, что уже в базе:
  // MT5 при частичном закрытии отдаёт ТУ ЖЕ позицию с пересчитанными
  // объёмом, ценой выхода и профитом (см. lib/mt/reimport.ts). Прежний
  // createMany({ skipDuplicates: true }) такую строку молча пропускал, и
  // сделка навсегда оставалась закрытой наполовину.
  //
  // Чтение существующих строк, запись новых, обновление дозакрытых и правка
  // баланса счёта идут ОДНОЙ транзакцией: обрыв на середине (рестарт
  // контейнера, таймаут) оставлял аккаунт с частью сделок — и с уже
  // переписанным балансом, из которого аналитика считала капитал по полному
  // отчёту, а PnL по его половине. Чтение внутри той же транзакции ещё и
  // закрывает гонку двух импортов одного счёта (отчёт руками + выгрузка
  // советника): иначе оба видели бы «строки нет» и дозакрытие терялось.
  const { res, diff } = await prisma.$transaction(
    async (tx) => {
      const existing = rows.length
        ? await tx.importedTrade.findMany({
            where: { accountId: account.id, externalId: { in: rows.map((r) => r.externalId) } },
            select: {
              id: true, externalId: true, symbol: true, side: true, lots: true, qty: true,
              contractSize: true, entryTime: true, exitTime: true, entryPrice: true,
              exitPrice: true, stopLoss: true, takeProfit: true, commission: true, swap: true,
              grossProfit: true, netPnl: true, pips: true, comment: true,
            },
          })
        : [];
      const diff = diffImport(rows, existing);

      const res = diff.create.length
        ? await tx.importedTrade.createMany({ data: diff.create, skipDuplicates: true })
        : { count: 0 };
      // По одной: значения у каждой строки свои, одним запросом их не обновить.
      // Дозакрытых позиций в отчёте единицы — это не горячий путь.
      //
      // importBatch НЕ трогаем намеренно: откат последней загрузки удаляет
      // партию целиком, и перевесив обновлённую строку на новый батч, мы бы
      // откатом СТЁРЛИ сделку, существовавшую до этой загрузки.
      for (const u of diff.update) {
        await tx.importedTrade.update({ where: { id: u.id }, data: u.data });
      }

      const now = new Date();
      await tx.exchangeAccount.update({
        where: { id: account.id },
        data: {
          lastSyncAt: now,
          ...(opts.push ? { lastPushAt: now } : {}),
          ...(deposit != null && deposit > 0
            ? { balance: deposit, balanceAt: now, capital: deposit }
            : {}),
        },
      });

      return { res, diff };
    },
    // Отчёт за год — это тысячи строк: дефолтных 5 секунд на транзакцию не
    // хватает, а роут всё равно живёт до maxDuration = 60.
    { maxWait: 10_000, timeout: 55_000 },
  );

  logger.info("import", account.id, "diff", {
    push: !!opts.push,
    created: diff.create.length,
    updated: diff.update.length,
    unchanged: diff.unchanged,
    // Видно, ПОЧЕМУ строка переписалась: дозакрыли объём или брокер поправил
    // своп задним числом — это разные истории.
    changes: diff.update.slice(0, 20).map((u) => ({ ticket: u.externalId, fields: u.changed })),
  });

  // Пересчёт R и сброс кэша — ПОСЛЕ коммита: оба читают уже записанное, а
  // держать их внутри транзакции значило бы продлевать её на долгий расчёт.
  // Новые ImportedTrade ещё без rr (колонка nullable) — считаем сразу,
  // иначе Сделки/Календарь показывали бы пусто до первой правки stopLoss.
  await recomputeRRForAccount(account.id).catch(() => {});
  bumpStatsVersion(userId);

  return {
    imported: res.count,
    // Дозакрытые позиции: сделка была, но брокер пересчитал её итог.
    updated: diff.update.length,
    // Честное «пришло то же самое», а не «знакомый тикет».
    skipped: diff.unchanged,
    parsed: rows.length,
    symbols,
    dateRange,
    netTotal,
    balance,
    deposit,
    batch,
  };
}
