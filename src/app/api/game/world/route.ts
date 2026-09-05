import { tickBots } from "@/lib/game/bots";
import { NextResponse, after } from "next/server";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { ensurePlayer, leaderboard, worldFeed } from "@/lib/game/world";
import { creditLimit, loanBoard } from "@/lib/game/loans";
import { fundBoard, memberShare } from "@/lib/game/funds";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Один запрос на весь общий мир: рейтинг, лента, фонды, займы и мой профиль.
// Клиент дёргает его редко (вкладка «Мир» + раз в минуту, пока она открыта),
// поэтому дешевле отдать всё сразу, чем гонять пять эндпоинтов.
/**
 * Такт ботов идёт здесь: боты «живут» в момент, когда кто-то смотрит на мир.
 * Фоновый процесс пришлось бы держать живым круглосуточно, а выигрыш нулевой
 * — если в мир никто не смотрит, шевелиться в нём незачем.
 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    // Не ждём ботов: их такт может уйти в языковую модель на секунду-другую,
    // а мир должен открыться сразу.
    // after() — а не «просто не ждать»: работа, брошенная через void, живёт
    // ровно до конца запроса, и такт ботов регулярно обрывался на середине
    // (отметка времени уже сдвинута, решение не принято). after() выполняет
    // её ПОСЛЕ ответа и не отменяет вместе с ним.
    after(() => tickBots().catch(() => {}));
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const profile = await prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } });
    const player = await ensurePlayer(user.userId, user.email, profile?.name ?? null);
    const [board, feed, funds, loans, myFund] = await Promise.all([
      leaderboard(),
      worldFeed(),
      fundBoard(),
      loanBoard(player.id),
      player.fundId
        ? prisma.gameFund.findUnique({
            where: { id: player.fundId },
            select: {
              id: true,
              name: true,
              motto: true,
              capital: true,
              feePct: true,
              ownerId: true,
              owner: { select: { nickname: true } },
              members: { select: { id: true, nickname: true, equity: true, contractsPassed: true, rankKey: true } },
            },
          })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      me: {
        id: player.id,
        nickname: player.nickname,
        rankKey: player.rankKey,
        prestige: player.prestige,
        equity: player.equity,
        contractsPassed: player.contractsPassed,
        reliability: player.reliability,
        pendingPayout: player.pendingPayout,
        isPublic: player.isPublic,
        fundId: player.fundId,
        creditLimit: creditLimit(player.equity, player.reliability, 0),
        fundShare: player.fundId ? await memberShare(player.fundId, player.id) : 0,
      },
      leaderboard: board,
      feed,
      funds,
      loans,
      myFund,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
