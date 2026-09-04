import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { syncPlayer } from "@/lib/game/world";
import { prisma } from "@/lib/db";
import { markOverdue } from "@/lib/game/loans";

export const dynamic = "force-dynamic";

const schema = z.object({
  fundName: z.string().max(40).nullable().optional(),
  rankKey: z.string().max(20),
  prestige: z.number(),
  level: z.number(),
  equity: z.number(),
  contractsPassed: z.number(),
  bestContractPct: z.number(),
  activeStyle: z.string().max(20),
  gameDay: z.number(),
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
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return badRequest("Проверьте данные");

    // Имя из профиля проекта: при первом создании игрового профиля ник
    // берётся из него, а не из почты.
    const profile = await prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } });
    const { player, claimed } = await syncPlayer(
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
      reliability: player.reliability,
      nickname: player.nickname,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
