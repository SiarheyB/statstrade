import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ensurePlayer, normalizeNickname } from "@/lib/game/world";

export const dynamic = "force-dynamic";

const schema = z.object({
  nickname: z.string().max(30).optional(),
  isPublic: z.boolean().optional(),
});

/** Имя в мире игры и видимость в рейтинге. */
export async function PATCH(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return badRequest("Проверьте данные");
    const player = await ensurePlayer(user.userId, user.email);

    const data: { nickname?: string; isPublic?: boolean } = {};
    if (parsed.data.nickname !== undefined) {
      const nickname = normalizeNickname(parsed.data.nickname);
      if (!nickname) return badRequest("Имя: от 3 до 20 символов, буквы, цифры, пробел, дефис");
      const taken = await prisma.gamePlayer.findFirst({
        where: { nickname, NOT: { id: player.id } },
        select: { id: true },
      });
      if (taken) return badRequest("Такое имя уже занято");
      data.nickname = nickname;
    }
    if (parsed.data.isPublic !== undefined) data.isPublic = parsed.data.isPublic;

    const updated = await prisma.gamePlayer.update({ where: { id: player.id }, data });
    return NextResponse.json({ ok: true, nickname: updated.nickname, isPublic: updated.isPublic });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
