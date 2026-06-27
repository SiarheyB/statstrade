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

// Кнопки = таймфрейм свечи → длительность одной свечи в мс. Окно просмотра
// растягивается на CANDLES_IN_WINDOW свечей этого таймфрейма (как на графике),
// поэтому 15m рисует 15-минутные свечи, 1h — часовые и т.д. Большие таймфреймы
// ограничены ретеншном коллектора (RETENTION_DAYS): покажется столько свечей,
// на сколько хватает истории стакана.
const TF_MS: Record<string, number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

// Сколько свечей таймфрейма помещаем в окно.
const CANDLES_IN_WINDOW = 100;

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const exchange = (url.searchParams.get("exchange") ?? "binance-futures").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const range = url.searchParams.get("range") ?? "1h";

  const tf = TF_MS[range];
  if (!tf) return badRequest("Неизвестный таймфрейм");
  if (symbol.length < 5 || symbol.length > 20) return badRequest("Некорректный символ");

  const toMs = Date.now();
  const fromMs = toMs - tf * CANDLES_IN_WINDOW;

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
