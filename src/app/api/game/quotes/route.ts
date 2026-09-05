import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { readNews, readQuotes } from "@/lib/game/marketStore";

export const dynamic = "force-dynamic";

// Сколько инструментов можно спросить за раз. У игрока в активном наборе их
// десятки, но просить весь рынок разом незачем — это лишняя генерация.
const MAX_ASSETS = 60;

/**
 * Текущие цены (и свежие новости) — то, чем живёт клиент между запросами
 * свечей. Раньше цены рисовал сам браузер, и у каждого игрока был свой рынок.
 */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const url = new URL(req.url);
    const assets = (url.searchParams.get("assets") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_ASSETS);
    const since = Number(url.searchParams.get("newsSince") ?? 0);

    const [quotes, news] = await Promise.all([
      readQuotes(assets),
      readNews(Number.isFinite(since) && since > 0 ? since : Date.now() - 6 * 60 * 60 * 1000, 40),
    ]);

    return NextResponse.json({ now: Date.now(), quotes, news });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
