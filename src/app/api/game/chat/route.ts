import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { ensurePlayer } from "@/lib/game/world";
import { normalizeChannel, postMessage, readMessages, MAX_MESSAGE_LENGTH } from "@/lib/game/social";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  empty: "Сообщение пустое",
  too_long: `Слишком длинно, максимум ${MAX_MESSAGE_LENGTH} символов`,
  too_fast: "Слишком часто — подождите пару секунд",
  unknown_channel: "Неизвестный канал",
  not_in_fund: "Вы не состоите в фонде",
};

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const player = await ensurePlayer(user.userId, user.email);
    const raw = new URL(req.url).searchParams.get("channel") ?? "general";
    const channel = normalizeChannel(raw, player.fundId);
    if (!channel) return badRequest(raw === "fund" ? MESSAGES.not_in_fund : MESSAGES.unknown_channel);

    return NextResponse.json({ channel: raw, messages: await readMessages(channel) });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.object({
  channel: z.string().max(20),
  text: z.string().max(1000),
  // Идея с графиком: инструмент, таймфрейм и разметка автора.
  assetId: z.string().max(60).nullable().optional(),
  tf: z.string().max(8).nullable().optional(),
  drawings: z.unknown().optional(),
});

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return badRequest("Проверьте данные");
    const player = await ensurePlayer(user.userId, user.email);
    const channel = normalizeChannel(parsed.data.channel, player.fundId);
    if (!channel) return badRequest(parsed.data.channel === "fund" ? MESSAGES.not_in_fund : MESSAGES.unknown_channel);

    const result = await postMessage(player.id, player.nickname, channel, parsed.data.text, {
      assetId: parsed.data.assetId,
      tf: parsed.data.tf,
      drawings: parsed.data.drawings,
    });
    if (!result.ok) return badRequest(MESSAGES[result.error] ?? "Не получилось");
    return NextResponse.json({ ok: true, id: result.value.id });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
