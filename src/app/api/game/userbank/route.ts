import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests, readJsonBody } from "@/lib/api";
import { checkGameLimit } from "@/lib/game/limits";
import { getFeatureConfig } from "@/lib/featureConfig";
import { ensurePlayer } from "@/lib/game/world";
import { prisma } from "@/lib/db";
import { readQuotes } from "@/lib/game/marketStore";
import { charterRequirements, foundBank, issuePaper, myBank, CHARTER } from "@/lib/game/userBank";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  no_player: "Профиль не найден",
  already_owner: "У вас уже есть банк",
  not_ready: "Условия лицензии не выполнены",
  no_slots: "Свободных лицензий не осталось",
  no_bank: "Банк не найден",
  bad_name: "Название: от 3 до 40 символов",
  bad_ticker: "Тикер: от трёх до пяти латинских букв",
  ticker_taken: "Такой тикер уже занят",
  nothing_left: "Бумаги закончились",
  bad_amount: "Проверьте количество",
};

/** Свой банк и готовность к получению лицензии. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const wait = checkGameLimit(user.userId, "read");
  if (wait) return tooManyRequests(wait);
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
    const player = await ensurePlayer(user.userId, user.email);
    const [bank, requirements] = await Promise.all([myBank(player.id), charterRequirements(player.id)]);
    // Цену бумаг отдаём с сервера, а не берём из набора инструментов на
    // клиенте: слоты банка попадают в него не сразу, а размещение считается
    // именно по биржевой цене — владелец должен видеть ту же цифру, по
    // которой пройдёт сделка.
    const quotes = bank ? await readQuotes(bank.papers.map((p) => p.assetId)) : {};
    const papers = bank?.papers.map((p) => ({ ...p, price: quotes[p.assetId]?.price ?? 0 }));
    return NextResponse.json({
      bank: bank ? { ...bank, papers } : null,
      requirements,
      charter: CHARTER,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("found"),
    name: z.string().max(60),
    ticker: z.string().max(10),
    motto: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal("issue"),
    kind: z.enum(["bank_share", "bank_bond"]),
    quantity: z.number().min(1).max(1e9),
  }),
]);

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  // Учреждение и размещение двигают общий баланс мира — это денежная
  // операция, а не просто запись, и лимит у неё соответствующий.
  const wait = checkGameLimit(user.userId, "money");
  if (wait) return tooManyRequests(wait);
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const parsed = schema.safeParse(await readJsonBody(req));
    if (!parsed.success) return badRequest("Проверьте данные");
    const player = await ensurePlayer(user.userId, user.email);

    if (parsed.data.action === "found") {
      const result = await foundBank(player.id, parsed.data.name, parsed.data.ticker, parsed.data.motto);
      if (!result.ok) return badRequest(MESSAGES[result.error] ?? "Не получилось");
      return NextResponse.json({ ok: true, ...result.value, deposit: CHARTER.deposit });
    }

    // Размещение идёт по БИРЖЕВОЙ цене — цену берём на сервере, клиенту в
    // ней верить нельзя.
    const bank = await prisma.gameUserBank.findUnique({ where: { ownerId: player.id }, select: { id: true } });
    if (!bank) return badRequest(MESSAGES.no_bank);
    const listing = await prisma.gameListing.findFirst({
      where: { bankId: bank.id, kind: parsed.data.kind },
      select: { assetId: true },
    });
    if (!listing) return badRequest(MESSAGES.no_bank);
    const quotes = await readQuotes([listing.assetId]);
    const result = await issuePaper(
      player.id,
      parsed.data.kind,
      parsed.data.quantity,
      quotes[listing.assetId]?.price ?? 0,
    );
    if (!result.ok) return badRequest(MESSAGES[result.error] ?? "Не получилось");
    return NextResponse.json({ ok: true, ...result.value });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
