import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";

export const maxDuration = 15;

// Доступные символы/биржи — из реально собранных collector-ом данных, чтобы
// селекторы на фронте соответствовали тому, что есть в БД.
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const [rows, cfg] = await Promise.all([
      prisma.obSnapshot.findMany({
        distinct: ["symbol", "exchange"],
        select: { symbol: true, exchange: true },
      }),
      prisma.collectorConfig.findMany({ select: { symbol: true, minCoins: true } }),
    ]);
    const symbols = Array.from(new Set(rows.map((r) => r.symbol))).sort();
    const exchanges = Array.from(new Set(rows.map((r) => r.exchange))).sort();
    // Пороги «только крупные лимитки» по символу (для подписи под фильтром).
    const minCoins: Record<string, number> = {};
    for (const c of cfg) minCoins[c.symbol] = c.minCoins;
    return NextResponse.json({ symbols, exchanges, minCoins });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
