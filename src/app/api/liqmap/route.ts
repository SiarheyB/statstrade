import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { computeLiqMap, type Exchange, type Timeframe } from "@/lib/liqmap";

export const maxDuration = 30;

const EXCHANGES = new Set(["all", "binance", "bybit", "okx"]);
const TFS = new Set(["1d", "2d", "7d", "1M", "3M"]);

// Small in-memory cache so repeated views don't re-hit the exchanges.
const cache = new Map<string, { at: number; data: unknown }>();
const TTL_MS = 60_000;

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const exchange = (url.searchParams.get("exchange") ?? "all").toLowerCase();
  const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const tf = url.searchParams.get("tf") ?? "7d";

  if (!EXCHANGES.has(exchange)) return badRequest("Неизвестная биржа");
  if (!TFS.has(tf)) return badRequest("Неизвестный таймфрейм");
  if (symbol.length < 5 || symbol.length > 20) return badRequest("Некорректный символ");

  const key = `${exchange}:${symbol}:${tf}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.data);

  try {
    const heatmap = await computeLiqMap(exchange as Exchange | "all", symbol, tf as Timeframe);
    if (!heatmap) return badRequest("Нет данных по этому символу/бирже");
    const data = { exchange, symbol, tf, heatmap };
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
