import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { serverError } from "@/lib/api";
import { getRecomputeProgress, startRecompute } from "@/lib/recommendations/progress";
import { getCandleScanStatus } from "@/lib/recommendations/candleScan";
import {
  BINANCE_DAILY_CLOSE_UTC_HOUR,
  RECOMPUTE_DELAY_MINUTES,
  nextScheduledRun,
} from "@/lib/recommendations/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function loadStatus() {
  const [total, bySymbol, byBias, byDirection, latest, collectorScan] = await Promise.all([
    prisma.levelSetup.count(),
    prisma.levelSetup.findMany({ distinct: ["symbol"], select: { symbol: true } }),
    prisma.levelSetup.groupBy({ by: ["bias"], _count: { _all: true } }),
    prisma.levelSetup.groupBy({ by: ["direction"], _count: { _all: true } }),
    prisma.levelSetup.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true, candlesTo: true } }),
    // Живое состояние скана свечей на коллекторе — чтобы закачка была видна и
    // тогда, когда её начали не отсюда (суточный таймер самого коллектора).
    getCandleScanStatus(),
  ]);
  return {
    total,
    symbolsCovered: bySymbol.length,
    byBias: Object.fromEntries(byBias.map((b) => [b.bias, b._count._all])),
    byDirection: Object.fromEntries(byDirection.map((d) => [d.direction, d._count._all])),
    lastComputedAt: latest?.createdAt ?? null,
    lastCandlesTo: latest?.candlesTo ?? null,
    progress: getRecomputeProgress(),
    collectorScan,
    schedule: {
      // Все времена — в UTC; в местное админу их переводит UI по его настройке
      // часового пояса. Данные общие для всех пользователей, поэтому сам
      // момент пересчёта от чьей-либо таймзоны зависеть не может.
      dailyCloseUtcHour: BINANCE_DAILY_CLOSE_UTC_HOUR,
      delayMinutes: RECOMPUTE_DELAY_MINUTES,
      nextRunAt: nextScheduledRun(new Date()).toISOString(),
      // Плановый пересчёт выполняет внутренний планировщик процесса app.
      autoEnabled: process.env.ENABLE_SCHEDULER !== "false",
    },
  };
}

// Раздел «Рекомендации» админ-панели. GET — снимок текущей "картины дня"
// (сколько уровней, когда последний раз пересчитано) плюс прогресс идущего
// пересчёта; админка опрашивает его, пока progress.running. POST — запускает
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

// Пересчёт запускается в фоне и НЕ ожидается здесь: по всем USDT-M фьючерсам
// он идёт дольше, чем разумный HTTP-таймаут, а прогресс-бар в админке всё
// равно тянет состояние из GET.
export async function POST() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const { started, progress, done } = startRecompute();
    if (started) {
      done
        .then((result) =>
          recordAudit(session, "recommendations.recompute", {
            targetType: "LevelSetup",
            detail: `symbolsScanned=${result.symbolsScanned}; levelsWritten=${result.levelsWritten}; neutralSkipped=${result.neutralSkipped}`,
          }),
        )
        .catch(() => {});
    }
    const status = await loadStatus();
    return NextResponse.json({ ...status, started, progress }, { status: started ? 202 : 409 });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
