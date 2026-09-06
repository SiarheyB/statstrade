import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Игровой профиль пользователя глазами админа — и правка его серверной части.
 *
 * Зачем правка: проверить игру целиком, торгуя вручную, нельзя — испытание
 * идёт неделю, рейтинг набирается месяц, а фонды и займы вообще требуют
 * второго человека. Админу нужно уметь поставить состояние, из которого он
 * проверяет нужный экран.
 *
 * ЧТО ЗДЕСЬ НЕЛЬЗЯ: игровые деньги. Баланс живёт в браузере игрока
 * (IndexedDB), сервер хранит только обязательства и снимок для рейтинга —
 * записать сюда «эквити 100000» значит соврать таблице, а у игрока на счету
 * ничего не изменится. Деньги передаются через `pendingPayout` — ту же
 * очередь, которой приходят проценты по займам и призы сезона: клиент
 * заберёт их при следующей синхронизации, и они станут настоящими.
 */
const schema = z.object({
  userId: z.string().min(1).max(60),
  nickname: z.string().max(30).optional(),
  prestige: z.number().min(0).max(100_000).optional(),
  level: z.number().min(0).max(10).optional(),
  contractsPassed: z.number().min(0).max(50).optional(),
  reliability: z.number().min(0).max(100).optional(),
  isPublic: z.boolean().optional(),
  /** Начислить (или списать) игроку денег через очередь получения. */
  grant: z.number().min(-10_000_000).max(10_000_000).optional(),
  /** Мут в минутах; 0 — снять. */
  muteMinutes: z.number().min(0).max(60 * 24 * 30).optional(),
});

export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return badRequest("Проверьте данные");
    const { userId, grant, muteMinutes, nickname, ...fields } = parsed.data;

    const player = await prisma.gamePlayer.findUnique({ where: { userId } });
    if (!player) return badRequest("Этот пользователь ещё не заходил в игру");

    const data: Record<string, unknown> = { ...fields };
    if (grant != null && grant !== 0) data.pendingPayout = { increment: grant };
    if (muteMinutes != null) data.mutedUntil = muteMinutes > 0 ? new Date(Date.now() + muteMinutes * 60_000) : null;
    if (nickname != null) {
      const clean = nickname.trim().replace(/\s+/g, " ");
      if (clean.length < 3 || clean.length > 20) return badRequest("Имя: от 3 до 20 символов");
      const taken = await prisma.gamePlayer.findFirst({ where: { nickname: clean, NOT: { id: player.id } } });
      if (taken) return badRequest("Такое имя уже занято");
      data.nickname = clean;
    }
    if (Object.keys(data).length === 0) return badRequest("Нечего менять");

    const updated = await prisma.gamePlayer.update({ where: { id: player.id }, data });
    await recordAudit(session, "game.player.update", {
      targetType: "user",
      targetId: userId,
      targetLabel: updated.nickname,
      detail: JSON.stringify(parsed.data),
    });

    return NextResponse.json({
      ok: true,
      player: {
        nickname: updated.nickname,
        prestige: updated.prestige,
        level: updated.level,
        contractsPassed: updated.contractsPassed,
        reliability: updated.reliability,
        isPublic: updated.isPublic,
        pendingPayout: updated.pendingPayout,
        mutedUntil: updated.mutedUntil?.getTime() ?? null,
      },
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
