import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { serverError } from "@/lib/api";
import { recomputeRecommendations } from "@/lib/recommendations/recompute";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function loadStatus() {
  const [total, bySymbol, byBias, latest] = await Promise.all([
    prisma.levelSetup.count(),
    prisma.levelSetup.findMany({ distinct: ["symbol"], select: { symbol: true } }),
    prisma.levelSetup.groupBy({ by: ["bias"], _count: { _all: true } }),
    prisma.levelSetup.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true, candlesTo: true } }),
  ]);
  return {
    total,
    symbolsCovered: bySymbol.length,
    byBias: Object.fromEntries(byBias.map((b) => [b.bias, b._count._all])),
    lastComputedAt: latest?.createdAt ?? null,
    lastCandlesTo: latest?.candlesTo ?? null,
  };
}

// Раздел «Рекомендации» админ-панели. GET — снимок текущей "картины дня"
// (сколько уровней, когда последний раз пересчитано). POST — принудительный
// пересчёт "сейчас" по уже собранным коллектором свечам (тот же путь, что
// у /api/cron/recommendations, но с сессионной авторизацией админа вместо
// CRON_SECRET — коллектор дневных свечей отдельно, раз в сутки, здесь не
// триггерится).
export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const status = await loadStatus();
    return NextResponse.json(status);
  } catch (err) {
    return serverError((err as Error).message);
  }
}

export async function POST() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const result = await recomputeRecommendations();
    await recordAudit(session, "recommendations.recompute", {
      targetType: "LevelSetup",
      detail: `symbolsScanned=${result.symbolsScanned}; levelsWritten=${result.levelsWritten}`,
    });
    const status = await loadStatus();
    return NextResponse.json({ ...status, lastRun: result });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
