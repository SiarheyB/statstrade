import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { readNews, readQuotes, readRegime } from "@/lib/game/marketStore";

export const dynamic = "force-dynamic";

// Сколько инструментов можно спросить за раз.
//
// Потолок должен покрывать ВЕСЬ справочник: набор игрока растёт (акции,
// крипта, форекс, облигации, бумаги банка, листинги фондов), а лишнее сверх
// потолка молча отбрасывалось — из-за чего у части инструментов не было
// цены, и в списке они стояли с прочерком. Молча терять данные хуже, чем
// сделать лишнюю выборку: генерация всё равно ленивая и происходит один раз
// на инструмент.
const MAX_ASSETS = 200;

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

    const [quotes, news, regime] = await Promise.all([
      readQuotes(assets),
      readNews(Number.isFinite(since) && since > 0 ? since : Date.now() - 24 * 60 * 60 * 1000, 40),
      readRegime(),
    ]);

    return NextResponse.json({ now: Date.now(), quotes, news, regime });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
