// R-multiple (RR) — считается и сохраняется здесь один раз, вместо того чтобы
// каждая страница (Сделки, Календарь) пересчитывала его сама при каждом
// запросе /api/stats. /api/stats просто читает готовое поле Trade.rr /
// ImportedTrade.rr.
//
// Точки пересчёта (точечные, не гоняем по всем сделкам пользователя зря):
//  - materialize.ts: после ребилда сделок аккаунта (новые филлы с биржи).
//  - /api/annotations PUT: правка stopLoss одной сделки — recomputeRRForTradeKey.
//  - /api/risk/settings PUT: смена риск-профиля — recomputeRRForAccount
//    (профиль влияет на риск сразу всех сделок аккаунта).
//  - /api/accounts/[id]/import: импорт форекс-отчёта — новые ImportedTrade
//    ещё без rr, нужен recomputeRRForAccount.
//  - instrumentation.ts (register(), однократно при старте процесса) —
//    backfillMissingRR() досчитывает rr для сделок, у которых он ещё NULL
//    (например, сделки, синхронизированные ДО того, как появилась колонка
//    rr — точечные триггеры выше на них не срабатывали и не сработают, пока
//    что-то в них не изменится). После первого успешного прогона это no-op
//    (запрос ничего не находит), так что безопасно оставлять на каждый старт.

import { prisma } from "@/lib/db";
import { tradeRR, parseRiskProfile, defaultRiskProfile, type RiskProfileData } from "@/lib/risk";
import { rebuildTradeHourly, rebuildTradeHourlyForTrade } from "./hourly";

async function loadRiskContext(accountId: string) {
  const account = await prisma.exchangeAccount.findUnique({
    where: { id: accountId },
    select: { userId: true, balance: true },
  });
  if (!account) return null;

  const profileRows = await prisma.riskProfile.findMany({
    where: { userId: account.userId, accountId: { in: [accountId, ""] } },
  });
  const profiles: Record<string, RiskProfileData> = { "": defaultRiskProfile() };
  for (const r of profileRows) profiles[r.accountId] = parseRiskProfile(r);

  return { profiles, balance: account.balance, userId: account.userId };
}

// Пересчитать и сохранить rr для ВСЕХ сделок аккаунта (crypto Trade +
// forex/MT ImportedTrade). Дешёвый bulk-апдейт (одна транзакция), но задевает
// все сделки — вызывать только когда реально меняется что-то аккаунт-уровня
// (риск-профиль, ребилд после синка), не на каждый чих.
export async function recomputeRRForAccount(accountId: string): Promise<void> {
  const ctx = await loadRiskContext(accountId);
  if (!ctx) return;

  const [cryptoTrades, importedTrades] = await Promise.all([
    prisma.trade.findMany({
      where: { accountId },
      select: {
        id: true, accountId: true, side: true, entryPrice: true, exitPrice: true,
        fees: true, qty: true, netPnl: true,
      },
    }),
    prisma.importedTrade.findMany({
      where: { accountId },
      select: {
        id: true, accountId: true, externalId: true, side: true, entryPrice: true,
        exitPrice: true, commission: true, qty: true, netPnl: true, stopLoss: true,
      },
    }),
  ]);
  // Дневные агрегаты пересобираем ДАЖЕ когда сделок не осталось — иначе после
  // удаления/перезалива сделок в TradeDaily висели бы устаревшие дни.
  if (cryptoTrades.length === 0 && importedTrades.length === 0) {
    await rebuildTradeHourly(accountId);
    return;
  }

  const tradeKeys = [
    ...cryptoTrades.map((t) => t.id),
    ...importedTrades.map((t) => `${t.accountId}:${t.externalId}`),
  ];
  const annotations = await prisma.tradeAnnotation.findMany({
    where: { tradeKey: { in: tradeKeys } },
    select: { tradeKey: true, stopLoss: true },
  });
  const annStopLoss = new Map(annotations.map((a) => [a.tradeKey, a.stopLoss]));

  const updates = [
    ...cryptoTrades.map((t) => {
      const stopLoss = annStopLoss.get(t.id) ?? null;
      const rr = tradeRR(t, stopLoss, ctx.profiles, ctx.balance);
      return prisma.trade.update({ where: { id: t.id }, data: { rr } });
    }),
    ...importedTrades.map((t) => {
      const key = `${t.accountId}:${t.externalId}`;
      const stopLoss = annStopLoss.has(key) ? (annStopLoss.get(key) ?? null) : t.stopLoss;
      const rr = tradeRR(
        {
          accountId: t.accountId, side: t.side, entryPrice: t.entryPrice,
          exitPrice: t.exitPrice, fees: t.commission, qty: t.qty, netPnl: t.netPnl,
        },
        stopLoss, ctx.profiles, ctx.balance,
      );
      return prisma.importedTrade.update({ where: { id: t.id }, data: { rr } });
    }),
  ];
  await prisma.$transaction(updates);
  // winR/lossR в дневных агрегатах складываются из только что записанного rr,
  // поэтому пересборка идёт строго после транзакции.
  await rebuildTradeHourly(accountId);
}

// Пересчитать и сохранить rr только для ОДНОЙ сделки — используется после
// правки stopLoss в аннотации, чтобы не гонять пересчёт по всему аккаунту на
// каждое сохранение. tradeKey = Trade.id для крипты или "accountId:externalId"
// для импортированных (форекс/MT) — в обоих случаях accountId это префикс до
// первого двоеточия (см. комментарий у Trade.id в schema.prisma).
export async function recomputeRRForTradeKey(tradeKey: string): Promise<void> {
  const sep = tradeKey.indexOf(":");
  const accountId = sep === -1 ? tradeKey : tradeKey.slice(0, sep);
  const ctx = await loadRiskContext(accountId);
  if (!ctx) return;

  const cryptoTrade = await prisma.trade.findUnique({ where: { id: tradeKey } });
  if (cryptoTrade) {
    const ann = await prisma.tradeAnnotation.findUnique({
      where: { userId_tradeKey: { userId: ctx.userId, tradeKey } },
      select: { stopLoss: true },
    });
    const rr = tradeRR(cryptoTrade, ann?.stopLoss ?? null, ctx.profiles, ctx.balance);
    await prisma.trade.update({ where: { id: tradeKey }, data: { rr } });
    // Меняется одна сделка → пересобираем только её день, а не всю историю.
    await rebuildTradeHourlyForTrade(accountId, cryptoTrade.exitTime);
    return;
  }

  if (sep === -1) return;
  const externalId = tradeKey.slice(sep + 1);
  const importedTrade = await prisma.importedTrade.findFirst({ where: { accountId, externalId } });
  if (!importedTrade) return;
  const ann = await prisma.tradeAnnotation.findUnique({
    where: { userId_tradeKey: { userId: ctx.userId, tradeKey } },
    select: { stopLoss: true },
  });
  const stopLoss = ann?.stopLoss ?? importedTrade.stopLoss ?? null;
  const rr = tradeRR(
    {
      accountId: importedTrade.accountId, side: importedTrade.side,
      entryPrice: importedTrade.entryPrice, exitPrice: importedTrade.exitPrice,
      fees: importedTrade.commission, qty: importedTrade.qty, netPnl: importedTrade.netPnl,
    },
    stopLoss, ctx.profiles, ctx.balance,
  );
  await prisma.importedTrade.update({ where: { id: importedTrade.id }, data: { rr } });
  await rebuildTradeHourlyForTrade(accountId, importedTrade.exitTime);
}

// Разовый (по факту — на каждый старт процесса, но дешёвый после первого
// прогона) бэкафилл: находит аккаунты, у которых есть хоть одна сделка с
// rr = NULL, и пересчитывает их целиком через recomputeRRForAccount. Нужен
// для сделок, попавших в БД до появления колонки rr — точечные хуки
// (materialize/annotations/risk settings) их не затронут, пока в них что-то
// не изменится вручную.
export async function backfillMissingRR(): Promise<{ accounts: number }> {
  const [cryptoGaps, importedGaps] = await Promise.all([
    prisma.trade.findMany({ where: { rr: null }, select: { accountId: true }, distinct: ["accountId"] }),
    prisma.importedTrade.findMany({ where: { rr: null }, select: { accountId: true }, distinct: ["accountId"] }),
  ]);
  const accountIds = new Set([
    ...cryptoGaps.map((r) => r.accountId),
    ...importedGaps.map((r) => r.accountId),
  ]);
  for (const id of accountIds) {
    await recomputeRRForAccount(id).catch(() => {});
  }
  return { accounts: accountIds.size };
}
