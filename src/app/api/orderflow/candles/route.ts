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
// TTL был 3000 мс при опросе клиента раз в 5000 мс — попаданий не бывало
// никогда, и КАЖДЫЙ опрос каждой открытой вкладки платил полную цену:
// чтение до 800 свечей из ObCandle, поход в Binance за формирующейся свечой и
// upsert в ObCandle (то есть запись в базу на GET-запросе). Поход в Binance —
// это 366 мс из ~400 (замер в комментарии к fetchOrderflowCandles), то есть
// девять десятых времени ответа.
//
// staleMs включает stale-while-revalidate, который routeCache уже умеет:
// просроченный ответ отдаётся мгновенно, а свежий считается в фоне. Клиент
// больше никогда не ждёт биржу, данные при этом отстают не сильнее, чем на
// собственный интервал опроса. Полный пересчёт видит только первый заход
// после старта процесса.
//
// TTL чуть меньше интервала опроса (5000): так фоновое обновление успевает
// закончиться к следующему тику и в кэше всегда лежит свежее.
//
// Окно простоя ограничено 20 секундами не случайно: в ответе едет `to`
// (правая граница окна), и клиент передаёт его во вторую фазу — /api/orderflow
// принимает границу только «около сейчас», ±60 с. Просроченный ответ старше
// этого получил бы там 400. Двадцати секунд с запасом хватает, чтобы прикрыть
// пересчёт (~400 мс), а больше и не нужно: смысл окна простоя в том, чтобы
// никто не ждал биржу, а не в том, чтобы отдавать минутную давность.
const TTL_MS = 4000;
const STALE_MS = 20_000;
const cache = createRouteCache(TTL_MS, 200, { staleMs: STALE_MS });

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
