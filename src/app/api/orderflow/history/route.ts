import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { fetchOrderflowCandlesBefore } from "@/lib/orderflow";

export const maxDuration = 30;

// Догрузка истории свечей "влево" по курсору — отдельный лёгкий эндпоинт
// (только candles, без heatmap/delta/footprint/ba/bigTrades — та часть
// живёт в /api/orderflow и не пагинируется в этой итерации). Вызывается
// фронтом при скролле/зуме графика к границе уже загруженных данных.
const RANGES = new Set(["5m", "15m", "1h", "4h", "12h", "1d", "1w"]);
const MAX_LIMIT = 1000;

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const exchange = (url.searchParams.get("exchange") ?? "binance-futures").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const range = url.searchParams.get("range") ?? "1h";
  const beforeParam = url.searchParams.get("before");
  const limitParam = url.searchParams.get("limit");

  if (!RANGES.has(range)) return badRequest("Неизвестный таймфрейм");
  if (symbol.length < 5 || symbol.length > 20) return badRequest("Некорректный символ");
  const before = beforeParam ? Number(beforeParam) : NaN;
  if (!Number.isFinite(before) || before <= 0) return badRequest("Некорректный параметр before");
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(limitParam) || 500));

  try {
    const { candles, hasMore } = await fetchOrderflowCandlesBefore(symbol, exchange, range, before, limit);
    return NextResponse.json({ candles, hasMore });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
