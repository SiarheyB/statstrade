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
    // ВАЖНО: distinct берём из маленькой rollup-таблицы (одна строка на
    // symbol×exchange×минута), а НЕ из сырого ObSnapshot (~десятки млн строк) —
    // Prisma-distinct без orderBy тянул бы строки в Node и падал по памяти (502).
    // DISTINCT по ведущим колонкам PK (symbol,exchange,bucket) идёт по индексу.
    const [rows, cfg] = await Promise.all([
      prisma.$queryRaw<{ symbol: string; exchange: string }[]>`
        SELECT DISTINCT symbol, exchange FROM "ObRollupBucket"
      `,
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
