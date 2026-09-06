import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests, readJsonBody } from "@/lib/api";
import { checkGameLimit } from "@/lib/game/limits";
import { getFeatureConfig } from "@/lib/featureConfig";
import { ensurePlayer } from "@/lib/game/world";
import { readQuotes } from "@/lib/game/marketStore";
import { BANK_SHARE_ASSET } from "@/lib/game/bank";
import {
  bankSummary,
  buyBond,
  buyRepossessed,
  redeemBond,
  repayBankLoan,
  takeBankLoan,
  tradeBankShares,
} from "@/lib/game/bank";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  no_bank: "Банк недоступен",
  too_small: "Сумма слишком мала",
  over_limit: "Больше лимита по вашему скорингу",
  bad_collateral: "Эта вещь не годится в залог",
  not_enough_capital: "У банка сейчас нет столько свободных средств",
  not_found: "Не найдено",
  already_repaid: "Уже закрыто",
  not_owner: "Это не ваше",
  sold_out: "Уже продано",
  not_matured: "Срок ещё не вышел — досрочно погасить нельзя",
};

// equity сюда больше не принимается: раньше клиент присылал что хотел
// (1e12 давало лимит в сотни миллиардов при реальной эквити 0 — подтверждено
// при нагрузочной проверке), теперь её всегда читает сам bank.ts из базы.
const query = z.object({ bankruptcies: z.number().min(0).max(1000) });

/** Витрина банка: скоринг, кредиты, облигации, акции, изъятое. */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const wait = checkGameLimit(user.userId, "read");
  if (wait) return tooManyRequests(wait);
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
    const url = new URL(req.url);
    const parsed = query.safeParse({
      bankruptcies: Number(url.searchParams.get("bankruptcies") ?? 0),
    });
    if (!parsed.success) return badRequest("Проверьте данные");
    const player = await ensurePlayer(user.userId, user.email);
    return NextResponse.json(await bankSummary(player.id, parsed.data.bankruptcies));
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
    action: z.literal("loan"),
    amount: z.number().finite().min(0).max(MAX_MONEY),
    termDays: z.number().finite().min(0).max(3650),
    collateralItem: z.string().max(60).nullable().optional(),
    ownedItems: z.array(z.string().max(60)).max(100).optional(),
    bankruptcies: z.number().min(0).max(1000),
  }),
  z.object({ action: z.literal("repay"), loanId: z.string().max(60) }),
  z.object({ action: z.literal("bond"), amount: z.number().finite().min(0).max(MAX_MONEY), termDays: z.number().finite().min(0).max(3650) }),
  z.object({ action: z.literal("redeem"), bondId: z.string().max(60) }),
  // Цена акции берётся с БИРЖИ: банк размещает по рыночной, иначе на разнице
  // между балансом и биржей получалась бы бесплатная бесконечная прибыль.
  z.object({ action: z.literal("shares"), quantity: z.number().min(-1e9).max(1e9) }),
  z.object({ action: z.literal("buyRepossessed"), id: z.string().max(60) }),
]);

/** Текущая биржевая цена акции банка. */
async function bankSharePrice(): Promise<number> {
  const quotes = await readQuotes([BANK_SHARE_ASSET]);
  return quotes[BANK_SHARE_ASSET]?.price ?? 0;
}

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
      body.action === "loan"
        ? await takeBankLoan(player.id, body.bankruptcies, {
            amount: body.amount,
            termDays: body.termDays,
            collateralItem: body.collateralItem ?? null,
            ownedItems: body.ownedItems ?? [],
          })
        : body.action === "repay"
          ? await repayBankLoan(player.id, body.loanId)
          : body.action === "bond"
            ? await buyBond(player.id, body.amount, body.termDays)
            : body.action === "redeem"
              ? await redeemBond(player.id, body.bondId)
              : body.action === "shares"
                ? await tradeBankShares(player.id, body.quantity, await bankSharePrice())
                : await buyRepossessed(player.id, body.id);

    if (!result.ok) return badRequest(MESSAGES[result.error] ?? "Не получилось");
    return NextResponse.json({ ok: true, ...result.value });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
