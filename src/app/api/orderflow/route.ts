import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import {
  computeOrderflow,
  computeDelta,
  computeFootprint,
  computeBigTrades,
  fetchOrderflowCandles,
  orderflowWindow,
  TF_MS,
} from "@/lib/orderflow";
import { isTimezone, normalizeTimezone } from "@/lib/timezone";
import { createRouteCache } from "@/lib/routeCache";

export const maxDuration = 30;

// Таймфрейм и ширина окна — в lib/orderflow (TF_MS + orderflowWindow): те же
// значения нужны эндпоинту свечей, который грузится первой фазой.

// Сколько свечей таймфрейма ТЯНЕМ в окно. Определено в orderflow.ts
// (импортируется выше) — чтобы fetchOrderflowCandles и buildPayload
// использовали одно значение.

type Payload = {
  symbol: string;
  exchange: string;
  range: string;
  from: number;
  to: number;
  heatmap: Awaited<ReturnType<typeof computeOrderflow>>;
  candles: Awaited<ReturnType<typeof fetchOrderflowCandles>> | null;
  delta: Awaited<ReturnType<typeof computeDelta>>;
  footprint: Awaited<ReturnType<typeof computeFootprint>>;
  bigTrades: Awaited<ReturnType<typeof computeBigTrades>>;
};

// Кэш ответа на короткий срок + дедупликация «в полёте». Запросы стакана —
// тяжёлые SQL-агрегации по миллионам строк, а LIVE опрашивает эндпоинт каждые
// несколько секунд. Без этого параллельные/частые поллы исчерпывали пул
// соединений Prisma (Timed out fetching a connection). Теперь одинаковые запросы
// в пределах TTL переиспользуют результат, а наложившиеся — общий промис.
const TTL_MS = 3000;
const cache = createRouteCache(TTL_MS);

// withCandles=false — вторая фаза загрузки: свечи уже пришли из
// /api/orderflow/candles, и повторно тянуть их (а вместе с ними ходить в
// Binance за формирующейся свечой — это 366 из ~400 мс, см. комментарий у
// fetchOrderflowCandles) незачем.
async function buildPayload(
  symbol: string,
  exchange: string,
  range: string,
  toMs: number,
  withCandles: boolean,
): Promise<Payload> {
  const win = orderflowWindow(range, toMs)!;
  const fromMs = win.from;
  const [heatmap, candles, delta, footprint, bigTrades] = await Promise.all([
    computeOrderflow(symbol, exchange, fromMs, win.to),
    withCandles ? fetchOrderflowCandles(symbol, exchange, range, fromMs, win.to) : Promise.resolve(null),
    computeDelta(symbol, exchange, fromMs, win.to),
    computeFootprint(symbol, exchange, range, fromMs, win.to),
    computeBigTrades(symbol, exchange, fromMs, win.to),
  ]);
  return { symbol, exchange, range, from: fromMs, to: win.to, heatmap, candles, delta, footprint, bigTrades };
}

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const exchange = (url.searchParams.get("exchange") ?? "binance-futures").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const range = url.searchParams.get("range") ?? "1h";
  const tzParam = url.searchParams.get("tz");
  // candles=0 — свечи уже получены первой фазой (/api/orderflow/candles).
  const withCandles = url.searchParams.get("candles") !== "0";
  // to — правая граница окна, посчитанная первой фазой: обе половины должны
  // лежать на одной сетке времени, иначе карта съедет относительно свечей.
  const toParam = url.searchParams.get("to");

  const tf = TF_MS[range];
  if (!tf) return badRequest("Неизвестный таймфрейм");
  if (symbol.length < 5 || symbol.length > 20) return badRequest("Некорректный символ");

  // Границу принимаем только «около сейчас»: окно карты всегда заканчивается
  // текущим моментом, а произвольное `to` из адресной строки означало бы
  // сколь угодно тяжёлый запрос по чужому диапазону.
  const now = Date.now();
  let toMs = now;
  if (toParam !== null) {
    const parsed = Number(toParam);
    if (!Number.isFinite(parsed) || Math.abs(now - parsed) > 60_000) {
      return badRequest("Некорректная граница окна");
    }
    toMs = parsed;
  }

  // Validate timezone if provided
  let timezone: string | undefined;
  if (tzParam !== null && tzParam !== undefined) {
    if (!isTimezone(tzParam)) {
      return badRequest("Некорректный часовой пояс");
    }
    timezone = normalizeTimezone(tzParam);
  }

  // `to` в ключ не входит: он гуляет в пределах минуты от «сейчас», и включать
  // его — значит гарантированно промахиваться мимо кэша на каждом опросе LIVE.
  const key = `${symbol}|${exchange}|${range}|${timezone ?? "none"}|${withCandles ? 1 : 0}`;
  try {
    // fetch = кэш + дедупликация «в полёте»: пока считается первый запрос,
    // параллельные переиспользуют его промис, а не запускают вторую тяжёлую
    // агрегацию (фронт опрашивает эндпоинт раз в 3 секунды).
    const response = await cache.fetch(key, async () => ({
      ...(await buildPayload(symbol, exchange, range, toMs, withCandles)),
      timezone: timezone || "auto", // Default to auto if not provided
    }));
    return NextResponse.json(response);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
