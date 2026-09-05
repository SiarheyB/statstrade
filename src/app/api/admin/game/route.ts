import { NextResponse } from "next/server";
import { getAdminSession, notFound } from "@/lib/admin";
import { serverError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ALL_ASSETS } from "@/lib/game/marketStore";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Полная статистика игры для админки: люди, деньги, рынок, займы, фонды.
 * Раньше про игру не было видно ничего, кроме двух тумблеров доступа —
 * нельзя было понять ни сколько людей играет, ни живой ли мир.
 */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const now = Date.now();
    const [
      players,
      activeDay,
      activeWeek,
      totals,
      topPlayers,
      funds,
      loanStats,
      loansByStatus,
      candles,
      newsCount,
      market,
      events,
      assetsWithHistory,
      byStyle,
      byRank,
    ] = await Promise.all([
      prisma.gamePlayer.count(),
      prisma.gamePlayer.count({ where: { lastSyncAt: { gte: new Date(now - DAY) } } }),
      prisma.gamePlayer.count({ where: { lastSyncAt: { gte: new Date(now - 7 * DAY) } } }),
      prisma.gamePlayer.aggregate({
        _sum: { equity: true, prestige: true, contractsPassed: true },
        _avg: { equity: true, reliability: true, level: true },
        _max: { equity: true, bestContractPct: true },
      }),
      prisma.gamePlayer.findMany({
        orderBy: [{ contractsPassed: "desc" }, { prestige: "desc" }],
        take: 10,
        select: {
          nickname: true,
          rankKey: true,
          prestige: true,
          level: true,
          equity: true,
          contractsPassed: true,
          bestContractPct: true,
          reliability: true,
          activeStyle: true,
          lastSyncAt: true,
        },
      }),
      prisma.gameFund.findMany({
        orderBy: { capital: "desc" },
        take: 10,
        select: {
          name: true,
          capital: true,
          feePct: true,
          createdAt: true,
          owner: { select: { nickname: true } },
          members: { select: { id: true } },
        },
      }),
      prisma.gameLoan.aggregate({ _sum: { amount: true }, _count: true }),
      prisma.gameLoan.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amount: true } }),
      prisma.gameCandle.count(),
      prisma.gameMarketNews.count(),
      prisma.gameMarket.findUnique({ where: { id: "world" } }),
      prisma.gameWorldEvent.count({ where: { createdAt: { gte: new Date(now - 7 * DAY) } } }),
      prisma.gameCandle.groupBy({ by: ["assetId"], where: { tf: "1d" }, _count: { _all: true } }),
      // Раскладка по стилям и рангам: по ней видно, во что реально играют, а
      // не во что мы думали, что играют.
      prisma.gamePlayer.groupBy({ by: ["activeStyle"], _count: { _all: true } }),
      prisma.gamePlayer.groupBy({ by: ["rankKey"], _count: { _all: true } }),
    ]);

    return NextResponse.json({
      players: {
        total: players,
        activeDay,
        activeWeek,
        avgEquity: totals._avg.equity ?? 0,
        maxEquity: totals._max.equity ?? 0,
        totalEquity: totals._sum.equity ?? 0,
        avgReliability: totals._avg.reliability ?? 0,
        avgLevel: totals._avg.level ?? 0,
        contractsPassed: totals._sum.contractsPassed ?? 0,
        bestContractPct: totals._max.bestContractPct ?? 0,
        byStyle: byStyle.map((r) => ({ style: r.activeStyle, count: r._count._all })),
        byRank: byRank.map((r) => ({ rank: r.rankKey, count: r._count._all })),
      },
      top: topPlayers,
      funds: funds.map((f) => ({
        name: f.name,
        capital: f.capital,
        feePct: f.feePct,
        owner: f.owner.nickname,
        members: f.members.length,
        createdAt: f.createdAt,
      })),
      loans: {
        total: loanStats._count,
        volume: loanStats._sum.amount ?? 0,
        byStatus: loansByStatus.map((r) => ({ status: r.status, count: r._count._all, amount: r._sum.amount ?? 0 })),
      },
      market: {
        seed: market?.seed ?? null,
        startedAt: market?.startedAt ?? null,
        candles,
        news: newsCount,
        assetsTotal: ALL_ASSETS.length,
        assetsGenerated: assetsWithHistory.length,
        daysGenerated: assetsWithHistory.reduce((max, row) => Math.max(max, row._count._all), 0),
      },
      worldEventsWeek: events,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

/**
 * Пересборка рынка: стирает сгенерированные свечи и новости, чтобы они
 * построились заново при первом же запросе.
 *
 * Это не «сброс игры»: прогресс игроков, займы, фонды и сообщения не
 * трогаются. Рынок детерминирован (цены считаются из сида и номера бара),
 * поэтому стереть его безопасно — он восстановится точно таким же, если сид
 * не менять. Кнопка нужна там, где старая история перестала соответствовать
 * правилам: поменяли волатильность в настройках баланса, добавили
 * расписание торгов, завели новый инструмент.
 *
 * `newSeed` меняет сид — тогда рынок восстановится ДРУГИМ. Это уже заметное
 * для игроков событие («мир начался заново»), поэтому отдельным флагом, а не
 * побочным эффектом.
 */
export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string; newSeed?: boolean };
    if (body.action !== "rebuildMarket") {
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }
    const [candles, news] = await Promise.all([
      prisma.gameCandle.deleteMany({}),
      prisma.gameMarketNews.deleteMany({}),
    ]);
    if (body.newSeed) {
      await prisma.gameMarket.updateMany({ data: { seed: crypto.randomUUID() } });
    }
    return NextResponse.json({ ok: true, removedCandles: candles.count, removedNews: news.count });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
