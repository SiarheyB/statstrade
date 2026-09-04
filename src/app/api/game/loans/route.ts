import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { ensurePlayer } from "@/lib/game/world";
import { cancelLoan, offerLoan, repayLoan, takeLoan } from "@/lib/game/loans";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("offer"),
    amount: z.number(),
    interestPct: z.number(),
    termDays: z.number(),
  }),
  z.object({ action: z.literal("cancel"), loanId: z.string().min(1).max(60) }),
  z.object({
    action: z.literal("take"),
    loanId: z.string().min(1).max(60),
    gameDay: z.number(),
    // Бонус к кредитному лимиту от перков «Связи»/«Кредитная линия».
    // Клиентское значение, поэтому режется на сервере.
    perkBonus: z.number().optional(),
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
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const parsed = schema.safeParse(await req.json());
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
