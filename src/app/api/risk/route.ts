import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { ensureAccountTrades } from "@/lib/analytics/materialize";
import { parseRiskProfile, computeAccountRisk, type RiskDay } from "@/lib/risk";

// Current risk status per account (monitoring only).
//
// Читает ДНЕВНЫЕ АГРЕГАТЫ (таблица TradeDaily, см. lib/analytics/daily.ts).
// История эндпоинта: сначала он реконструировал сделки из всех филлов юзера,
// потом читал материализованные Trade, теперь — готовые суммы по дням.
// RiskBanner висит на дашборде и «Сделках», т.е. дёргается на каждый их рендер,
// а строк тут максимум по числу торговых дней аккаунта (≤365 в окне), а не по
// числу сделок.
//
// Числа не меняются: границы всех окон риск-менеджера проходят по границам
// суток UTC (periodStart() в lib/risk.ts), а TradeDaily нарезан ровно так же.
//
// Окно — с начала текущего года по UTC: самый широкий лимит риск-менеджера это
// "year", дни старше него на статус не влияют.
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
    const dayRows = accounts.length
      ? await prisma.tradeDaily.findMany({
          where: {
            accountId: { in: accounts.map((a) => a.id) },
            day: { gte: yearStart },
          },
          select: { accountId: true, day: true, netPnl: true, wins: true, losses: true },
        })
      : [];

    const byAccount = new Map<string, RiskDay[]>();
    for (const r of dayRows) {
      const arr = byAccount.get(r.accountId) ?? [];
      arr.push({ day: r.day, netPnl: r.netPnl, wins: r.wins, losses: r.losses });
      byAccount.set(r.accountId, arr);
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
