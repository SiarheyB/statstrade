import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { reconstructTrades } from "@/lib/analytics/positions";
import type { FillInput } from "@/lib/analytics/types";
import { parseRiskProfile, computeAccountRisk, type RiskTrade } from "@/lib/risk";

// Current risk status per account (monitoring only). Computed from synced fills.
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    // Only live exchange accounts are risk-monitored; imported (forex) accounts
    // are file-loaded and have no real-time state.
    const accounts = await prisma.exchangeAccount.findMany({
      where: { userId: user.userId, source: "exchange" },
      select: { id: true, label: true, exchange: true, balance: true },
    });

    const fills = await prisma.fill.findMany({
      where: { account: { userId: user.userId } },
      orderBy: { timestamp: "asc" },
    });
    const inputs: FillInput[] = fills.map((f) => ({
      symbol: f.symbol,
      base: f.base,
      quote: f.quote,
      market: f.market,
      side: f.side,
      price: f.price,
      amount: f.amount,
      fee: f.fee,
      feeCurrency: f.feeCurrency,
      timestamp: f.timestamp,
      exchange: f.exchange,
      accountId: f.accountId,
    }));
    const trades = reconstructTrades(inputs);

    const byAccount = new Map<string, RiskTrade[]>();
    for (const t of trades) {
      const arr = byAccount.get(t.accountId) ?? [];
      arr.push({ accountId: t.accountId, netPnl: t.netPnl, exitTime: t.exitTime, result: t.result });
      byAccount.set(t.accountId, arr);
    }

    const profileRows = await prisma.riskProfile.findMany({ where: { userId: user.userId } });
    const profileMap = new Map(profileRows.map((r) => [r.accountId, r]));
    const def = parseRiskProfile(profileMap.get("") ?? null);

    const now = new Date();
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
