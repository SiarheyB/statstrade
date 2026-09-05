import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { ensurePlayer } from "@/lib/game/world";
import { joinTournament, tournamentStandings } from "@/lib/game/tournaments";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  already_joined: "Вы уже записаны в этот турнир",
  finished: "Турнир уже закончился",
  not_found: "Турнир не найден",
};

/** Таблица текущего турнира. Смена турнира происходит здесь же, лениво. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
    const player = await ensurePlayer(user.userId, user.email);
    return NextResponse.json(await tournamentStandings(player.id));
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.object({ equity: z.number().min(0).max(1e12) });

/**
 * Записаться в турнир.
 *
 * Взнос списывает КЛИЕНТ у себя: игровой баланс живёт в браузере, сервер
 * хранит только обязательства. Сервер лишь фиксирует участие и увеличивает
 * призовой фонд — а фонд возвращается победителям тем же каналом, что призы
 * сезона.
 */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return badRequest("Проверьте данные");
    const player = await ensurePlayer(user.userId, user.email);

    const result = await joinTournament(player.id, parsed.data.equity);
    if (!result.ok) return badRequest(MESSAGES[result.error] ?? "Не получилось");
    return NextResponse.json({ ok: true, ...result.value });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
