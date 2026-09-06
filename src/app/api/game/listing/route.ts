import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests, readJsonBody } from "@/lib/api";
import { checkGameLimit } from "@/lib/game/limits";
import { getFeatureConfig } from "@/lib/featureConfig";
import { ensurePlayer } from "@/lib/game/world";
import { prisma } from "@/lib/db";
import { readQuotes } from "@/lib/game/marketStore";
import { allListings, listFund, listingRequirements, placeShares } from "@/lib/game/listing";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  no_fund: "Фонд не найден",
  not_owner: "Это не ваш фонд",
  already_listed: "Фонд уже на бирже",
  too_young: "Фонд работает слишком недолго",
  too_small: "Капитала не хватает",
  too_few_members: "Слишком мало участников",
  owner_not_ready: "Владельцу нужно пройти хотя бы одно испытание",
  no_slots: "Свободных мест на бирже нет",
  ticker_taken: "Такой тикер уже занят",
  bad_ticker: "Тикер: от трёх до пяти латинских букв",
};

/** Листинги и готовность своего фонда к выходу на биржу. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const wait = checkGameLimit(user.userId, "read");
  if (wait) return tooManyRequests(wait);
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
    const player = await ensurePlayer(user.userId, user.email);
    const myFund = await prisma.gameFund.findUnique({ where: { ownerId: player.id }, select: { id: true } });
    const [listings, requirements] = await Promise.all([
      allListings(),
      myFund ? listingRequirements(myFund.id) : Promise.resolve(null),
    ]);
    return NextResponse.json({ listings, myFundId: myFund?.id ?? null, requirements });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), ticker: z.string().max(10) }),
  z.object({ action: z.literal("place"), quantity: z.number().min(1).max(1e9) }),
]);

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const wait = checkGameLimit(user.userId, "write");
  if (wait) return tooManyRequests(wait);
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const parsed = schema.safeParse(await readJsonBody(req));
    if (!parsed.success) return badRequest("Проверьте данные");
    const player = await ensurePlayer(user.userId, user.email);
    const fund = await prisma.gameFund.findUnique({ where: { ownerId: player.id }, select: { id: true } });
    if (!fund) return badRequest(MESSAGES.no_fund);

    if (parsed.data.action === "list") {
      const result = await listFund(player.id, fund.id, parsed.data.ticker);
      if (!result.ok) return badRequest(MESSAGES[result.error] ?? "Не получилось");
      return NextResponse.json({ ok: true, ...result.value });
    }

    // Размещение идёт по БИРЖЕВОЙ цене: иначе на разнице с балансовой
    // получались бы бесплатные деньги.
    const listing = await prisma.gameListing.findUnique({ where: { fundId: fund.id }, select: { assetId: true } });
    if (!listing) return badRequest(MESSAGES.no_fund);
    const quotes = await readQuotes([listing.assetId]);
    const result = await placeShares(fund.id, parsed.data.quantity, quotes[listing.assetId]?.price ?? 0);
    if (!result.ok) return badRequest(MESSAGES[result.error] ?? "Не получилось");
    return NextResponse.json({ ok: true, ...result.value });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
