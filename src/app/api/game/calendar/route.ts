import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { getMarket } from "@/lib/game/marketStore";
import { scheduleBetween } from "@/lib/game/marketGen";

export const dynamic = "force-dynamic";

// Насколько далеко вперёд отдаём расписание. Три недели — это «эта неделя,
// следующая и немного запаса»; дальше загадывать нечего.
const MAX_AHEAD_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * Календарь публикаций: что и когда выйдет.
 *
 * Результат НЕ отдаётся — только время, сила и заголовок события. Направление
 * шока считается в тот же час, что и сама новость: иначе игра свелась бы к
 * чтению будущего.
 */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const url = new URL(req.url);
    const now = Date.now();
    const from = Number(url.searchParams.get("from") ?? now);
    const to = Number(url.searchParams.get("to") ?? now + 7 * 24 * 60 * 60 * 1000);
    const safeFrom = Number.isFinite(from) ? from : now;
    const safeTo = Math.min(Number.isFinite(to) ? to : now, safeFrom + MAX_AHEAD_MS);

    const market = await getMarket();
    // Заголовок готов заранее: у макрособытия он свой и не требует
    // подстановок — ни инструмента, ни отрасли у него нет.
    const events = scheduleBetween(market.seed, safeFrom, safeTo).map((event) => ({
      ts: event.ts,
      impact: event.impact,
      title: event.title,
    }));

    return NextResponse.json({ now, events });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
