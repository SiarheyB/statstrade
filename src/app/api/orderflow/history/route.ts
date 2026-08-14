import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { fetchOrderflowCandlesBefore, computeOrderflow, computeFootprint } from "@/lib/orderflow";
import { createRouteCache } from "@/lib/routeCache";

export const maxDuration = 30;

// Догрузка истории "влево" по курсору. Вызывается фронтом при скролле/зуме
// графика к границе уже загруженных данных.
//
// Раньше эндпоинт отдавал ТОЛЬКО свечи, а heatmap/footprint/bigTrades жили в
// /api/orderflow и считались за фиксированное окно (CANDLES_IN_WINDOW × ТФ).
// Из-за этого на мелких таймфреймах карта ордеров и кластеры обрывались:
// на 5m окно = 400 × 5 мин ≈ 33 часа, а в БД (ObSnapshotRollup) лежат сутки
// за сутками — при скролле влево появлялись свечи, но лимитки и кластеры
// заканчивались. Теперь срез приходит вместе со своими наложениями, и клиент
// рисует их отдельными сегментами (у каждого своя сетка времени и цен).
const RANGES = new Set(["5m", "15m", "1h", "4h", "12h", "1d", "1w"]);
const MAX_LIMIT = 1000;

// Наложения для уже прошедшего среза не меняются, но при быстром скролле один
// и тот же кусок запрашивается по нескольку раз — TTL тут может быть длиннее,
// чем у live-эндпоинта (3с).
const TTL_MS = 60_000;
const cache = createRouteCache(TTL_MS);

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const exchange = (url.searchParams.get("exchange") ?? "binance-futures").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const range = url.searchParams.get("range") ?? "1h";
  const beforeParam = url.searchParams.get("before");
  const limitParam = url.searchParams.get("limit");
  // overlays=0 — старое поведение (только свечи). Оставлено для дешёвых
  // запросов, которым карта не нужна.
  const wantOverlays = url.searchParams.get("overlays") !== "0";

  if (!RANGES.has(range)) return badRequest("Неизвестный таймфрейм");
  if (symbol.length < 5 || symbol.length > 20) return badRequest("Некорректный символ");
  const before = beforeParam ? Number(beforeParam) : NaN;
  if (!Number.isFinite(before) || before <= 0) return badRequest("Некорректный параметр before");
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(limitParam) || 500));

  try {
    const key = `${symbol}|${exchange}|${range}|${before}|${limit}|${wantOverlays ? 1 : 0}`;
    const payload = await cache.fetch(key, async () => {
      const { candles, hasMore } = await fetchOrderflowCandlesBefore(symbol, exchange, range, before, limit);
      if (!wantOverlays || candles.length === 0) {
        return { candles, hasMore, heatmap: null, footprint: null };
      }
      // Границы наложений — ровно по срезу свечей, чтобы сегмент лёг на график
      // встык с уже загруженным куском, без нахлёста и без дырки.
      const fromMs = candles[0].t;
      const toMs = before;
      // Крупные сделки сюда не тянем: на канвасе они не рисуются, а боковой
      // список показывает текущее окно — историю в него подмешивать незачем.
      const [heatmap, footprint] = await Promise.all([
        computeOrderflow(symbol, exchange, fromMs, toMs),
        computeFootprint(symbol, exchange, range, fromMs, toMs),
      ]);
      return { candles, hasMore, heatmap, footprint };
    });
    return NextResponse.json(payload);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
