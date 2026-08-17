import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { fetchOrderflowCandles, orderflowWindow } from "@/lib/orderflow";
import { createRouteCache } from "@/lib/routeCache";

export const maxDuration = 30;

/**
 * Только свечи карты ордеров — первая фаза загрузки страницы.
 *
 * Раньше страница ждала один общий /api/orderflow, который считал разом пять
 * агрегаций, и самая тяжёлая из них (heatmap за окно шириной до года)
 * задерживала показ вообще всего. Теперь график рисуется по этому ответу —
 * чтение ObCandle по первичному ключу, десятки миллисекунд, — а наложения
 * приходят следом, отдельным запросом.
 *
 * В ответе есть `to`: клиент передаёт его во второй запрос, чтобы обе половины
 * окна совпали по времени (см. orderflowWindow).
 */
const TTL_MS = 3000;
const cache = createRouteCache(TTL_MS);

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const exchange = (url.searchParams.get("exchange") ?? "binance-futures").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const range = url.searchParams.get("range") ?? "1h";

  const win = orderflowWindow(range);
  if (!win) return badRequest("Неизвестный таймфрейм");
  if (symbol.length < 5 || symbol.length > 20) return badRequest("Некорректный символ");

  try {
    const key = `${symbol}|${exchange}|${range}`;
    const payload = await cache.fetch(key, async () => {
      const candles = await fetchOrderflowCandles(symbol, exchange, range, win.from, win.to);
      return { symbol, exchange, range, from: win.from, to: win.to, candles };
    });
    return NextResponse.json(payload);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
