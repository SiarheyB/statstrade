import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { ensurePlayer } from "@/lib/game/world";
import { buyStrategy, listStrategies, publishStrategy, reportStrategyRecords, MAX_STRATEGIES_PER_AUTHOR } from "@/lib/game/social";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  invalid_name: "Название: от 3 до 40 символов",
  invalid_price: "Цена вне допустимых границ",
  too_many: `Больше ${MAX_STRATEGIES_PER_AUTHOR} стратегий одному автору нельзя`,
  not_found: "Стратегия не найдена",
  own_strategy: "Это ваша собственная стратегия",
  already_bought: "Эта стратегия уже куплена",
};

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
    const player = await ensurePlayer(user.userId, user.email);
    return NextResponse.json({ strategies: await listStrategies(player.id) });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("publish"),
    name: z.string().max(60),
    description: z.string().max(300).optional(),
    price: z.number(),
    config: z.object({
      strategy: z.string().max(30),
      assetId: z.string().max(60),
      riskPct: z.number(),
      stopPct: z.number(),
      takePct: z.number(),
    }),
    botId: z.string().max(60).optional(),
  }),
  z.object({ action: z.literal("buy"), strategyId: z.string().max(60) }),
  z.object({
    // Итоги своих ботов. Присылает клиент автора: сервер игровых сделок не
    // видит, счёт живёт в браузере.
    action: z.literal("report"),
    records: z
      .array(
        z.object({
          strategyId: z.string().max(60),
          trades: z.number(),
          winRate: z.number(),
          avgPnl: z.number(),
        }),
      )
      .max(20),
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

    if (body.action === "report") {
      const updated = await reportStrategyRecords(player.id, body.records);
      return NextResponse.json({ ok: true, updated });
    }

    const result =
      body.action === "publish"
        ? await publishStrategy(player.id, player.nickname, body.name, body.description ?? "", body.price, body.config, body.botId)
        : await buyStrategy(player.id, player.nickname, body.strategyId);

    if (!result.ok) return badRequest(MESSAGES[result.error] ?? "Не получилось");
    return NextResponse.json({ ok: true, ...result.value });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
