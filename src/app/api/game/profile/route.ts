import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ensurePlayer } from "@/lib/game/world";

export const dynamic = "force-dynamic";

// Имя сюда больше не приходит: оно берётся из профиля проекта и не
// редактируется. Меняемый псевдоним обесценивал бы и рейтинг, и репутацию
// заёмщика — под новым именем человек начинал бы с чистой историей.
const schema = z.object({
  isPublic: z.boolean().optional(),
});

/** Видимость в рейтинге. Имя не меняется — см. комментарий выше. */
export async function PATCH(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return badRequest("Проверьте данные");
    const player = await ensurePlayer(user.userId, user.email);

    const data: { isPublic?: boolean } = {};
    if (parsed.data.isPublic !== undefined) data.isPublic = parsed.data.isPublic;

    const updated = await prisma.gamePlayer.update({ where: { id: player.id }, data });
    return NextResponse.json({ ok: true, nickname: updated.nickname, isPublic: updated.isPublic });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
