import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests, readJsonBody } from "@/lib/api";
import { checkGameLimit } from "@/lib/game/limits";
import { getFeatureConfig } from "@/lib/featureConfig";
import { syncPlayer } from "@/lib/game/world";
import { prisma } from "@/lib/db";
import { markOverdue } from "@/lib/game/loans";

export const dynamic = "force-dynamic";

// Потолок любой суммы, приходящей от клиента.
//
// Без него `z.number()` пропускал 1e308: два таких «вклада» превращали
// капитал фонда в Infinity, после чего ни один рейтинг больше не
// сортировался. Триллион — заведомо больше всего, что бывает в игре, и
// заведомо далеко от границ double.
const MAX_MONEY = 1e12;

const schema = z.object({
  fundName: z.string().max(40).nullable().optional(),
  rankKey: z.string().max(20),
  prestige: z.number().finite(),
  level: z.number().finite(),
  equity: z.number().finite().min(0).max(MAX_MONEY),
  contractsPassed: z.number().finite(),
  bestContractPct: z.number().finite(),
  activeStyle: z.string().max(20),
  gameDay: z.number().finite().min(0).max(1_000_000),
});

/**
 * Синхронизация профиля игрока с общим миром. Вызывается клиентом примерно
 * раз в минуту, пока открыта игра.
 *
 * Возвращает claimed — деньги, которые игроку причитаются (проценты по
 * выданным займам, выплаты фонда). Сервер их обнуляет у себя, клиент
 * зачисляет на игровой баланс: другого способа передать деньги в чужую
 * браузерную симуляцию нет.
 */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const wait = checkGameLimit(user.userId, "sync");
  if (wait) return tooManyRequests(wait);
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const parsed = schema.safeParse(await readJsonBody(req));
    if (!parsed.success) return badRequest("Проверьте данные");

    // Имя из профиля проекта: при первом создании игрового профиля ник
    // берётся из него, а не из почты.
    const profile = await prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } });
    const { player, claimed, seizedItems } = await syncPlayer(
      user.userId,
      user.email,
      { ...parsed.data, fundName: parsed.data.fundName ?? null },
      profile?.name ?? null,
    );
    // Просрочку считаем здесь же: срок займа живёт в ИГРОВЫХ днях заёмщика,
    // а их знает только его клиент — сервер узнаёт о них ровно в этот момент.
    const defaulted = await markOverdue(player.id, player.nickname, player.gameDay);

    return NextResponse.json({
      ok: true,
      claimed,
      defaulted,
      // Вещи, изъятые банком за просрочку: клиент уберёт их у себя. Отдаются
      // ровно один раз — сервер их тут же забывает.
      seizedItems,
      reliability: player.reliability,
      nickname: player.nickname,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
