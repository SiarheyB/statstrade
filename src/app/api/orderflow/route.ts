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
  "1w": 7 * 24 * 60 * 60_000,
};

// Сколько свечей таймфрейма помещаем в окно — по таймфрейму (как в ClusterBtc,
// где свечей на графике много). Детали кластеров смотрят приближением (зум).
// Стоимость запроса heatmap ограничена данными коллектора (~7 дней), а не
// размером окна, поэтому на больших ТФ счётчик можно держать высоким.
const CANDLES_IN_WINDOW: Record<string, number> = {
  "15m": 120,
  "1h": 110,
  "4h": 100,
  "24h": 90,
  "1w": 60,
};
const DEFAULT_CANDLES = 100;

type Payload = {
  symbol: string;
  exchange: string;
  range: string;
  from: number;
  to: number;
  heatmap: Awaited<ReturnType<typeof computeOrderflow>>;
  candles: Awaited<ReturnType<typeof fetchOrderflowCandles>>;
  delta: Awaited<ReturnType<typeof computeDelta>>;
  footprint: Awaited<ReturnType<typeof computeFootprint>>;
  ba: Awaited<ReturnType<typeof computeBA>>;
  bigTrades: Awaited<ReturnType<typeof computeBigTrades>>;
};

// Кэш ответа на короткий срок + дедупликация «в полёте». Запросы стакана —
// тяжёлые SQL-агрегации по миллионам строк, а LIVE опрашивает эндпоинт каждые
// несколько секунд. Без этого параллельные/частые поллы исчерпывали пул
// соединений Prisma (Timed out fetching a connection). Теперь одинаковые запросы
// в пределах TTL переиспользуют результат, а наложившиеся — общий промис.
const TTL_MS = 12000;
const cache = new Map<string, { at: number; data: Payload }>();
const inflight = new Map<string, Promise<Payload>>();

async function buildPayload(symbol: string, exchange: string, range: string, tf: number): Promise<Payload> {
  const toMs = Date.now();
  const fromMs = toMs - tf * (CANDLES_IN_WINDOW[range] ?? DEFAULT_CANDLES);
  const [heatmap, candles, delta, footprint, ba, bigTrades] = await Promise.all([
    computeOrderflow(symbol, exchange, fromMs, toMs),
    fetchOrderflowCandles(symbol, exchange, range, fromMs, toMs),
    computeDelta(symbol, exchange, fromMs, toMs),
    computeFootprint(symbol, exchange, range, fromMs, toMs),
    computeBA(symbol, exchange, fromMs, toMs),
    computeBigTrades(symbol, exchange, fromMs, toMs),
  ]);
  return { symbol, exchange, range, from: fromMs, to: toMs, heatmap, candles, delta, footprint, ba, bigTrades };
}

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

  const key = `${symbol}|${exchange}|${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.data);

  try {
    let p = inflight.get(key);
    if (!p) {
      p = buildPayload(symbol, exchange, range, tf).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const data = await p;
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
