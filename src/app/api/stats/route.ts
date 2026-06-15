import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { reconstructTrades } from "@/lib/analytics/positions";
import { computeMetrics } from "@/lib/analytics/metrics";
import type { FillInput } from "@/lib/analytics/types";
import {
  parseOptions,
  DEFAULT_ENTRY_POINTS,
  DEFAULT_ENTRY_TYPES,
  DEFAULT_MISTAKES,
} from "@/lib/annotations";
import type { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId") ?? "all";
  const market = url.searchParams.get("market") ?? "all"; // all | spot | futures
  const symbol = url.searchParams.get("symbol") ?? "all";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const entryPoint = url.searchParams.get("entryPoint") ?? "all";
  const entryType = url.searchParams.get("entryType") ?? "all";
  const mistake = url.searchParams.get("mistake") ?? "all";
  const initialCapital = Number(url.searchParams.get("initialCapital") ?? "10000");

  try {
    // Restrict to accounts owned by this user.
    const accounts = await prisma.exchangeAccount.findMany({
      where: { userId: user.userId },
      select: { id: true, label: true, exchange: true },
    });
    const ownedIds = new Set(accounts.map((a) => a.id));

    const where: Prisma.FillWhereInput = {
      account: { userId: user.userId },
    };
    if (accountId !== "all" && ownedIds.has(accountId)) {
      where.accountId = accountId;
    }
    if (market === "spot") where.market = "spot";
    else if (market === "futures") where.market = { in: ["swap", "future"] };
    if (symbol !== "all") where.symbol = symbol;
    // Note: date range is applied to reconstructed trades (by exit time) below,
    // not to fills — otherwise positions opened before the range get truncated.

    const fills = await prisma.fill.findMany({
      where,
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

    // Attach manual annotations (ТВХ / тип входа) to the reconstructed trades.
    const tradeKeys = trades.map((t) => t.id);
    const [userRow, annotations] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.userId },
        select: {
          entryPointOptions: true,
          entryTypeOptions: true,
          mistakeOptions: true,
        },
      }),
      prisma.tradeAnnotation.findMany({
        where: { userId: user.userId, tradeKey: { in: tradeKeys } },
      }),
    ]);
    const annMap = new Map(annotations.map((a) => [a.tradeKey, a]));
    for (const t of trades) {
      const a = annMap.get(t.id);
      t.entryPoint = a?.entryPoint ?? null;
      t.entryType = a?.entryType ?? null;
      t.mistake = a?.mistake ?? null;
      t.stopLoss = a?.stopLoss ?? null;
    }

    // Date range: keep trades CLOSED within [from, to] (exit time).
    let filteredTrades = trades;
    const fromMs = from ? new Date(from).getTime() : null;
    const toMs = to ? new Date(to).getTime() : null;
    if (fromMs != null || toMs != null) {
      filteredTrades = filteredTrades.filter((t) => {
        const x = t.exitTime.getTime();
        if (fromMs != null && x < fromMs) return false;
        if (toMs != null && x > toMs) return false;
        return true;
      });
    }
    if (entryPoint !== "all") {
      filteredTrades = filteredTrades.filter((t) =>
        entryPoint === "__unset__" ? !t.entryPoint : t.entryPoint === entryPoint,
      );
    }
    if (entryType !== "all") {
      filteredTrades = filteredTrades.filter((t) =>
        entryType === "__unset__" ? !t.entryType : t.entryType === entryType,
      );
    }
    if (mistake !== "all") {
      filteredTrades = filteredTrades.filter((t) =>
        mistake === "__unset__" ? !t.mistake : t.mistake === mistake,
      );
    }

    const metrics = computeMetrics(
      filteredTrades,
      Number.isFinite(initialCapital) && initialCapital > 0 ? initialCapital : 10000,
    );

    const allSymbols = Array.from(new Set(fills.map((f) => f.symbol))).sort();

    // Serialize trades (Dates -> ISO) for the client table.
    const serializedTrades = filteredTrades.map((t) => ({
      ...t,
      entryPoint: t.entryPoint ?? null,
      entryType: t.entryType ?? null,
      mistake: t.mistake ?? null,
      stopLoss: t.stopLoss ?? null,
      entryTime: t.entryTime.toISOString(),
      exitTime: t.exitTime.toISOString(),
    }));

    return NextResponse.json({
      metrics,
      trades: serializedTrades,
      fillCount: fills.length,
      symbols: allSymbols,
      accounts,
      entryPointOptions: parseOptions(userRow?.entryPointOptions, DEFAULT_ENTRY_POINTS),
      entryTypeOptions: parseOptions(userRow?.entryTypeOptions, DEFAULT_ENTRY_TYPES),
      mistakeOptions: parseOptions(userRow?.mistakeOptions, DEFAULT_MISTAKES),
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
