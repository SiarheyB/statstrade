import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest } from "@/lib/api";

// Returns exit fills for a trade — these are the partial closures.
// For a long trade: sell fills are exits.
// For a short trade: buy fills are exits.
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId") ?? "";
  const symbol = url.searchParams.get("symbol") ?? "";
  const market = url.searchParams.get("market") ?? "spot";
  const side = url.searchParams.get("side") ?? "long";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";

  if (!accountId || !symbol || !from || !to) {
    return badRequest("accountId, symbol, from, to required");
  }

  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return badRequest("Invalid date range");
  }

  // Exit side: for long → sell, for short → buy
  const exitSide = side === "long" ? "sell" : "buy";

  try {
    const fills = await prisma.fill.findMany({
      where: {
        accountId,
        symbol,
        market,
        side: exitSide,
        timestamp: { gte: new Date(fromMs), lte: new Date(toMs) },
      },
      orderBy: { timestamp: "asc" },
      select: {
        id: true,
        price: true,
        amount: true,
        cost: true,
        realizedPnl: true,
        timestamp: true,
      },
    });

    return NextResponse.json({
      fills: fills.map((f) => ({
        id: f.id,
        price: f.price,
        amount: f.amount,
        cost: f.cost,
        realizedPnl: f.realizedPnl,
        timestamp: f.timestamp.toISOString(),
        time: f.timestamp.getTime(),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { fills: [], error: (err as Error).message },
      { status: 200 },
    );
  }
}