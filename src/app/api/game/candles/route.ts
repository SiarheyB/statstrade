import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests } from "@/lib/api";
import { checkGameLimit } from "@/lib/game/limits";
import { getFeatureConfig } from "@/lib/featureConfig";
import { getAsset, readCandles, TIMEFRAMES, MAX_BARS } from "@/lib/game/marketStore";

export const dynamic = "force-dynamic";

/**
 * Свечи инструмента. Рынок общий для всех игроков, поэтому и ответ у всех
 * одинаковый — данные приходят из базы, а не считаются в браузере.
 */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const wait = checkGameLimit(user.userId, "read");
  if (wait) return tooManyRequests(wait);
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const url = new URL(req.url);
    const assetId = url.searchParams.get("assetId") ?? "";
    const tf = url.searchParams.get("tf") ?? "1m";
    const rawLimit = Number(url.searchParams.get("limit") ?? 300);
    // Ноль и отрицательные раньше тихо превращались в один бар вместо
    // ошибки: readCandles внутри берёт Math.min(rawLimit, MAX_BARS), а с
    // нуля/минуса это давало не «пусто», а какой-то случайный хвост запроса.
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.floor(rawLimit) : NaN;

    if (!getAsset(assetId)) return badRequest("Неизвестный инструмент");
    if (!TIMEFRAMES[tf]) return badRequest("Неизвестный таймфрейм");
    if (!Number.isFinite(limit)) return badRequest("Неверный limit");

    const candles = await readCandles(assetId, tf, limit);
    return NextResponse.json({ assetId, tf, candles, maxBars: MAX_BARS });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
