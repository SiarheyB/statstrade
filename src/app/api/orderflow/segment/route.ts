import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { computeOrderflow, computeFootprint, rollupLevelFor, TF_MS } from "@/lib/orderflow";
import { createRouteCache } from "@/lib/routeCache";

export const maxDuration = 30;

/**
 * Наложения (карта лимиток + кластеры) для ПРОИЗВОЛЬНОГО отрезка времени —
 * вторая фаза догрузки истории при скролле влево.
 *
 * Раньше /api/orderflow/history отдавал свечи и наложения одним ответом, и
 * прокрутка ждала самое тяжёлое из двух. Теперь клиент сперва получает и рисует
 * свечи, а этот эндпоинт дорисовывает поверх них карту — тот же порядок, что и
 * при первой загрузке страницы.
 *
 * Произвольный отрезок здесь безопасен благодаря каскаду агрегатов: уровень
 * выбирается по ширине колонки, поэтому и год, и десять лет читаются из дневных
 * бакетов примерно одинаково дёшево.
 */
const RANGES = new Set(["5m", "15m", "1h", "4h", "12h", "1d", "1w"]);
// Прошлое неизменяемо, поэтому один и тот же кусок можно держать дольше, чем
// живое окно: при скролле туда-сюда он запрашивается повторно.
const TTL_MS = 5 * 60_000;
const MAX_SPAN_MS = 12 * 365 * 86_400_000;
const cache = createRouteCache(TTL_MS);

// Сетка выравнивания границ: бакет того уровня каскада, с которого отрезок
// будет читаться. Без выравнивания каждый пиксель прокрутки давал бы новые
// границы, и кэш не срабатывал бы ни разу.
const GRID_MS = { minute: 60_000, hour: 3600_000, day: 86_400_000 } as const;

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const exchange = (url.searchParams.get("exchange") ?? "binance-futures").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const range = url.searchParams.get("range") ?? "1h";
  const from = Number(url.searchParams.get("from"));
  const to = Number(url.searchParams.get("to"));

  if (!RANGES.has(range)) return badRequest("Неизвестный таймфрейм");
  if (symbol.length < 5 || symbol.length > 20) return badRequest("Некорректный символ");
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return badRequest("Некорректный отрезок");
  }
  if (to - from > MAX_SPAN_MS) return badRequest("Слишком широкий отрезок");
  // Границы окна не могут уходить в будущее дальше одной свечи таймфрейма.
  if (from > Date.now() + TF_MS[range]) return badRequest("Некорректный отрезок");

  const grid = GRID_MS[rollupLevelFor(from, to, 240)];
  const fromMs = Math.floor(from / grid) * grid;
  const toMs = Math.ceil(to / grid) * grid;

  try {
    const key = `${symbol}|${exchange}|${range}|${fromMs}|${toMs}`;
    const payload = await cache.fetch(key, async () => {
      const [heatmap, footprint] = await Promise.all([
        computeOrderflow(symbol, exchange, fromMs, toMs),
        computeFootprint(symbol, exchange, range, fromMs, toMs),
      ]);
      return { from: fromMs, to: toMs, heatmap, footprint };
    });
    return NextResponse.json(payload);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
