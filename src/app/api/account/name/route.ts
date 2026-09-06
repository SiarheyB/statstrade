import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { defaultNickname, normalizeNickname } from "@/lib/game/world";

export const dynamic = "force-dynamic";

const schema = z.object({ name: z.string().min(1).max(80) });

/**
 * Имя пользователя в проекте (User.name). При регистрации оно необязательное,
 * и до появления игры его негде было указать — а игре имя нужно: оно стоит в
 * шапке терминала и в общем рейтинге, где безымянный игрок выглядит
 * недоразумением.
 */
export async function PATCH(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return badRequest("Проверьте данные");
    const name = normalizeNickname(parsed.data.name);
    if (!name) return badRequest("Имя: от 3 до 20 символов — буквы, цифры, пробел, дефис");

    await prisma.user.update({ where: { id: user.userId }, data: { name } });

    // Заодно подтягиваем имя в мир игры, если игрок ещё не менял его сам:
    // профиль мог создаться раньше (при первой синхронизации) с ником из
    // почты, и оставлять «trader-0zt1» рядом с настоящим именем незачем.
    const player = await prisma.gamePlayer.findUnique({ where: { userId: user.userId } });
    if (player && player.nickname === defaultNickname(user.email, user.userId)) {
      const taken = await prisma.gamePlayer.findFirst({
        where: { nickname: name, NOT: { id: player.id } },
        select: { id: true },
      });
      if (!taken) await prisma.gamePlayer.update({ where: { id: player.id }, data: { nickname: name } });
    }

    return NextResponse.json({ ok: true, name });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
