import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
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
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const url = new URL(req.url);
    const assetId = url.searchParams.get("assetId") ?? "";
    const tf = url.searchParams.get("tf") ?? "1m";
    const limit = Number(url.searchParams.get("limit") ?? 300);

    if (!getAsset(assetId)) return badRequest("Неизвестный инструмент");
    if (!TIMEFRAMES[tf]) return badRequest("Неизвестный таймфрейм");

    const candles = await readCandles(assetId, tf, Number.isFinite(limit) ? limit : 300);
    return NextResponse.json({ assetId, tf, candles, maxBars: MAX_BARS });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
