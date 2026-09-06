import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests, readJsonBody } from "@/lib/api";
import { checkGameLimit } from "@/lib/game/limits";
import { getFeatureConfig } from "@/lib/featureConfig";
import { ensurePlayer } from "@/lib/game/world";
import { cancelLoan, offerLoan, repayLoan, takeLoan } from "@/lib/game/loans";

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
    action: z.literal("offer"),
    amount: z.number().finite().min(0).max(MAX_MONEY),
    interestPct: z.number().finite().min(0).max(1000),
    termDays: z.number().finite().min(0).max(3650),
  }),
  z.object({ action: z.literal("cancel"), loanId: z.string().min(1).max(60) }),
  z.object({
    action: z.literal("take"),
    loanId: z.string().min(1).max(60),
    gameDay: z.number().finite().min(0).max(1_000_000),
    // Бонус к кредитному лимиту от перков «Связи»/«Кредитная линия».
    // Клиентское значение, поэтому режется на сервере.
    perkBonus: z.number().finite().min(0).max(10).optional(),
  }),
  z.object({ action: z.literal("repay"), loanId: z.string().min(1).max(60) }),
]);

// Ошибки движка займов — человеческим языком. Клиент показывает их как есть.
const MESSAGES: Record<string, string> = {
  invalid_amount: "Сумма вне допустимых границ",
  invalid_interest: "Процент вне допустимых границ",
  invalid_term: "Срок вне допустимых границ",
  not_found: "Заём не найден",
  not_yours: "Это не ваш заём",
  already_taken: "Предложение уже забрали",
  own_loan: "Нельзя занять у самого себя",
  limit_exceeded: "Превышен кредитный лимит",
  low_reliability: "Слишком низкая репутация заёмщика",
  not_active: "Заём уже закрыт",
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
      body.action === "offer"
        ? await offerLoan(player.id, player.nickname, body.amount, body.interestPct, body.termDays)
        : body.action === "cancel"
          ? await cancelLoan(player.id, body.loanId)
          : body.action === "take"
            ? await takeLoan(
                player.id,
                player.nickname,
                body.loanId,
                Math.max(0, Math.round(body.gameDay)),
                player.equity,
                player.reliability,
                // Перк даёт максимум удвоение лимита — больше не пропускаем,
                // каким бы числом ни прислал клиент.
                Math.max(0, Math.min(1, body.perkBonus ?? 0)),
              )
            : await repayLoan(player.id, player.nickname, body.loanId);

    if (!result.ok) return badRequest(MESSAGES[result.error] ?? "Не получилось");
    return NextResponse.json({ ok: true, ...result.value });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
