import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { ensurePlayer } from "@/lib/game/world";
import {
  feedFor,
  leaders,
  payLeaderFee,
  publishSignal,
  setSignalsOpen,
  subscribe,
  unsubscribe,
  MAX_SIGNAL_FEE_PCT,
  MIN_SIGNAL_FEE_PCT,
} from "@/lib/game/copytrading";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  self: "На себя подписаться нельзя",
  not_open: "Этот игрок закрыт для подписки",
  not_found: "Игрок не найден",
  invalid_fee: `Комиссия: от ${MIN_SIGNAL_FEE_PCT}% до ${MAX_SIGNAL_FEE_PCT}%`,
  already: "Подписка уже есть",
};

/** Витрина ведущих и лента сигналов тех, на кого игрок подписан. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
    const player = await ensurePlayer(user.userId, user.email);
    const [board, feed] = await Promise.all([leaders(player.id), feedFor(player.id)]);
    return NextResponse.json({ leaders: board, ...feed });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), feePct: z.number() }),
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("subscribe"), leaderId: z.string().max(60), auto: z.boolean().optional() }),
  z.object({ action: z.literal("unsubscribe"), leaderId: z.string().max(60) }),
  z.object({
    // Публикует клиент ведущего в момент открытия позиции.
    action: z.literal("publish"),
    assetId: z.string().max(60),
    side: z.string().max(10),
    price: z.number(),
    stopPct: z.number().nullable().optional(),
    takePct: z.number().nullable().optional(),
  }),
  z.object({
    // Подписчик закрыл скопированную сделку в плюс — платим ведущему.
    action: z.literal("fee"),
    leaderId: z.string().max(60),
    profit: z.number().min(0).max(1e9),
    feePct: z.number().min(0).max(MAX_SIGNAL_FEE_PCT),
  }),
]);

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return badRequest("Проверьте данные");
    const player = await ensurePlayer(user.userId, user.email);
    const body = parsed.data;

    if (body.action === "open" || body.action === "close") {
      const result = await setSignalsOpen(player.id, body.action === "open", body.action === "open" ? body.feePct : 0);
      if (!result.ok) return badRequest(MESSAGES[result.error] ?? "Не получилось");
      return NextResponse.json({ ok: true });
    }

    if (body.action === "subscribe") {
      const result = await subscribe(player.id, body.leaderId, body.auto ?? false);
      if (!result.ok) return badRequest(MESSAGES[result.error] ?? "Не получилось");
      return NextResponse.json({ ok: true, feePct: result.value.feePct });
    }

    if (body.action === "unsubscribe") {
      await unsubscribe(player.id, body.leaderId);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "publish") {
      await publishSignal(player.id, body);
      return NextResponse.json({ ok: true });
    }

    const fee = await payLeaderFee(body.leaderId, body.profit, body.feePct);
    return NextResponse.json({ ok: true, fee });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
