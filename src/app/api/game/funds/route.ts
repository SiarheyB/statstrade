import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests, readJsonBody } from "@/lib/api";
import { checkGameLimit } from "@/lib/game/limits";
import { getFeatureConfig } from "@/lib/featureConfig";
import { ensurePlayer } from "@/lib/game/world";
import { createFund, depositToFund, joinFund, leaveFund, payoutFund, withdrawFromFund } from "@/lib/game/funds";

export const dynamic = "force-dynamic";

// Потолок любой суммы, приходящей от клиента.
//
// Без него `z.number()` пропускал 1e308: два таких «вклада» превращали
// капитал фонда в Infinity, после чего ни один рейтинг больше не
// сортировался. Триллион — заведомо больше всего, что бывает в игре, и
// заведомо далеко от границ double.
const MAX_MONEY = 1e12;

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().min(1).max(40),
    motto: z.string().max(120).optional(),
    feePct: z.number().finite().min(0).max(100),
  }),
  z.object({ action: z.literal("join"), fundId: z.string().min(1).max(60) }),
  z.object({ action: z.literal("leave") }),
  z.object({ action: z.literal("deposit"), amount: z.number().finite().min(0).max(MAX_MONEY) }),
  z.object({ action: z.literal("withdraw"), amount: z.number().finite().min(0).max(MAX_MONEY) }),
  z.object({ action: z.literal("payout"), amount: z.number().finite().min(0).max(MAX_MONEY) }),
]);

const MESSAGES: Record<string, string> = {
  not_enough_prestige: "Нужен престиж — фонд открывают состоявшимся трейдерам",
  name_taken: "Фонд с таким названием уже есть",
  invalid_name: "Название: от 3 до 32 символов",
  already_in_fund: "Вы уже состоите в фонде",
  not_found: "Фонд не найден",
  not_owner: "Так может только владелец фонда",
  owner_cannot_leave: "Владелец не может выйти из своего фонда",
  invalid_amount: "Некорректная сумма",
  not_member: "Вы не состоите в фонде",
  exceeds_share: "Больше вашей доли не забрать",
  insufficient_capital: "В фонде недостаточно капитала",
};

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

    const result =
      body.action === "create"
        ? await createFund(player.id, player.nickname, player.prestige, player.fundId, body.name, body.motto ?? "", body.feePct)
        : body.action === "join"
          ? await joinFund(player.id, player.nickname, body.fundId, player.fundId)
          : body.action === "leave"
            ? await leaveFund(player.id, player.fundId)
            : body.action === "deposit"
              ? await depositToFund(player.id, player.fundId, body.amount)
              : body.action === "withdraw"
                ? await withdrawFromFund(player.id, player.fundId, body.amount)
                : await payoutFund(player.id, player.fundId, body.amount);

    if (!result.ok) return badRequest(MESSAGES[result.error] ?? "Не получилось");
    return NextResponse.json({ ok: true, ...result.value });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
