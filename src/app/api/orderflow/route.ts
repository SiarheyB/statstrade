import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import {
  computeOrderflow,
  computeDelta,
  computeFootprint,
  computeBA,
  computeBigTrades,
  fetchOrderflowCandles,
} from "@/lib/orderflow";

export const maxDuration = 30;

// Доступные диапазоны просмотра → длительность в мс.
const RANGES: Record<string, number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const exchange = (url.searchParams.get("exchange") ?? "binance-futures").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const range = url.searchParams.get("range") ?? "1h";

  const span = RANGES[range];
  if (!span) return badRequest("Неизвестный диапазон");
  if (symbol.length < 5 || symbol.length > 20) return badRequest("Некорректный символ");

  const toMs = Date.now();
  const fromMs = toMs - span;

  try {
    const [heatmap, candles, delta, footprint, ba, bigTrades] = await Promise.all([
      computeOrderflow(symbol, exchange, fromMs, toMs),
      fetchOrderflowCandles(symbol, exchange, range, fromMs, toMs),
      computeDelta(symbol, exchange, fromMs, toMs),
      computeFootprint(symbol, exchange, range, fromMs, toMs),
      computeBA(symbol, exchange, fromMs, toMs),
      computeBigTrades(symbol, exchange, fromMs, toMs),
    ]);
    return NextResponse.json({
      symbol, exchange, range, from: fromMs, to: toMs,
      heatmap, candles, delta, footprint, ba, bigTrades,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
