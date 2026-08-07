import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { ensureAccountTrades } from "@/lib/analytics/materialize";
import { parseRiskProfile, computeAccountRisk } from "@/lib/risk";
import { periodStart, type HourBucket } from "@/lib/analytics/periods";
import { tzOffsetFromRequest } from "@/lib/tzParam";

// Current risk status per account (monitoring only).
//
// Читает ПОЧАСОВЫЕ АГРЕГАТЫ (таблица TradeHourly, см. lib/analytics/hourly.ts).
// История эндпоинта: сначала он реконструировал сделки из всех филлов юзера,
// потом читал материализованные Trade, теперь — готовые суммы по часам.
// RiskBanner висит на дашборде и «Сделках», т.е. дёргается на каждый их рендер.
//
// Окна лимитов (день/неделя/месяц/год) считаются в ТАЙМЗОНЕ ПОЛЬЗОВАТЕЛЯ:
// клиент присылает свой сдвиг в минутах (?tzOffset), почасовые бакеты
// складываются в локальные сутки. Дневной агрегат для этого не годился бы —
// один UTC-день попадает на два локальных.
//
// Окно выборки — с начала локального года: самый широкий лимит это "year",
// часы старше него на статус не влияют.
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const offsetMinutes = tzOffsetFromRequest(req);

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
    const yearStart = new Date(periodStart("year", now, offsetMinutes));
    const hourRows = accounts.length
      ? await prisma.tradeHourly.findMany({
          where: {
            accountId: { in: accounts.map((a) => a.id) },
            hour: { gte: yearStart },
          },
          select: {
            accountId: true, hour: true, netPnl: true, wins: true, losses: true,
            winR: true, lossR: true, trades: true,
          },
        })
      : [];

    const byAccount = new Map<string, HourBucket[]>();
    for (const r of hourRows) {
      const arr = byAccount.get(r.accountId) ?? [];
      arr.push({
        hour: r.hour, netPnl: r.netPnl, wins: r.wins, losses: r.losses,
        winR: r.winR, lossR: r.lossR, trades: r.trades,
      });
      byAccount.set(r.accountId, arr);
    }

    const profileRows = await prisma.riskProfile.findMany({ where: { userId: user.userId } });
    const profileMap = new Map(profileRows.map((r) => [r.accountId, r]));
    const def = parseRiskProfile(profileMap.get("") ?? null);

    const accountRisks = accounts.map((a) => {
      const override = profileMap.get(a.id);
      const profile = override ? parseRiskProfile(override) : def;
      const risk = computeAccountRisk(
        a.id, byAccount.get(a.id) ?? [], a.balance, profile, offsetMinutes, now,
      );
      return { ...risk, label: a.label, exchange: a.exchange, custom: !!override };
    });

    return NextResponse.json({ accounts: accountRisks, defaultEnabled: def.enabled });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
