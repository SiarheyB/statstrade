import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests, readJsonBody } from "@/lib/api";
import { checkGameLimit } from "@/lib/game/limits";
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
  const wait = checkGameLimit(user.userId, "read");
  if (wait) return tooManyRequests(wait);
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
    const player = await ensurePlayer(user.userId, user.email);
    return NextResponse.json({ strategies: await listStrategies(player.id) });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Потолок любой суммы, приходящей от клиента.
//
// Без него `z.number()` пропускал 1e308: два таких «вклада» превращали
// капитал фонда в Infinity, после чего ни один рейтинг больше не
// сортировался. Триллион — заведомо больше всего, что бывает в игре, и
// заведомо далеко от границ double.
const MAX_MONEY = 1e12;

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("publish"),
    name: z.string().max(60),
    description: z.string().max(300).optional(),
    price: z.number().finite().min(0).max(MAX_MONEY),
    config: z.object({
      strategy: z.string().max(30),
      assetId: z.string().max(60),
      riskPct: z.number().finite().min(0).max(100),
      stopPct: z.number().finite().min(0).max(1000),
      takePct: z.number().finite().min(0).max(1000),
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
          trades: z.number().finite().min(0).max(1_000_000),
          winRate: z.number().finite().min(0).max(100),
          avgPnl: z.number(),
        }),
      )
      .max(20),
  }),
]);

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const wait = checkGameLimit(user.userId, "money");
  if (wait) return tooManyRequests(wait);
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const parsed = schema.safeParse(await readJsonBody(req));
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
