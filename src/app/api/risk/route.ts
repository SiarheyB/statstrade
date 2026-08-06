import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { ensureAccountTrades } from "@/lib/analytics/materialize";
import { parseRiskProfile, computeAccountRisk, type RiskTrade } from "@/lib/risk";

// Current risk status per account (monitoring only).
//
// Читает МАТЕРИАЛИЗОВАННЫЕ сделки (таблица Trade), а не реконструирует их из
// филлов на каждый запрос: RiskBanner висит на дашборде и «Сделках», т.е.
// эндпоинт дёргается на каждый их рендер, а реконструкция гоняла всю историю
// филлов пользователя (см. lib/analytics/materialize.ts — ровно от этого
// /api/stats уже ушёл).
//
// Окно — с начала текущего года по UTC: самый широкий лимит риск-менеджера это
// "year" (periodStart() в lib/risk.ts), сделки старше него на статус не влияют.
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    // Only live exchange accounts are risk-monitored; imported (forex) accounts
    // are file-loaded and have no real-time state.
    const accounts = await prisma.exchangeAccount.findMany({
      where: { userId: user.userId, source: "exchange" },
      select: { id: true, label: true, exchange: true, balance: true, tradesRebuiltAt: true },
    });
    // Одноразовый бэкафилл для аккаунтов, у которых Trade ещё не строился
    // (legacy / первый запрос после деплоя) — тот же путь, что в /api/stats.
    // Без него у такого аккаунта риск показал бы ноль вместо реальных цифр.
    await ensureAccountTrades(accounts);

    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const tradeRows = accounts.length
      ? await prisma.trade.findMany({
          where: {
            accountId: { in: accounts.map((a) => a.id) },
            exitTime: { gte: yearStart },
          },
          select: { accountId: true, netPnl: true, exitTime: true, result: true },
        })
      : [];

    const byAccount = new Map<string, RiskTrade[]>();
    for (const t of tradeRows) {
      const arr = byAccount.get(t.accountId) ?? [];
      arr.push({
        accountId: t.accountId,
        netPnl: t.netPnl,
        exitTime: t.exitTime,
        result: t.result,
      });
      byAccount.set(t.accountId, arr);
    }

    const profileRows = await prisma.riskProfile.findMany({ where: { userId: user.userId } });
    const profileMap = new Map(profileRows.map((r) => [r.accountId, r]));
    const def = parseRiskProfile(profileMap.get("") ?? null);

    const accountRisks = accounts.map((a) => {
      const override = profileMap.get(a.id);
      const profile = override ? parseRiskProfile(override) : def;
      const risk = computeAccountRisk(a.id, byAccount.get(a.id) ?? [], a.balance, profile, now);
      return { ...risk, label: a.label, exchange: a.exchange, custom: !!override };
    });

    return NextResponse.json({ accounts: accountRisks, defaultEnabled: def.enabled });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
