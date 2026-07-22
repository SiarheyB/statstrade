import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { computeImbalance, computeSpeedOfTape } from "@/lib/orderflow";

export const maxDuration = 30;

// Периоды (те же, что в /api/orderflow/divergence).
const PERIOD_MS: Record<string, number> = {
  "1h": 3_600_000,
  "4h": 14_400_000,
  "12h": 43_200_000,
  "24h": 86_400_000,
  "2d": 172_800_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};
const DEFAULT_PERIOD = "24h";

// Кэш (TTL 12с).
const TTL_MS = 12000;
const cache = new Map<string, { at: number; data: unknown }>();

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const exchange = (url.searchParams.get("exchange") ?? "binance-futures").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const periodKey = url.searchParams.get("period") ?? DEFAULT_PERIOD;

  // Валидация символа.
  if (symbol.length < 5) {
    return badRequest("Некорректный символ: минимальная длина 5 символов");
  }

  // Валидация period.
  const periodMs = PERIOD_MS[periodKey];
  if (!periodMs) {
    return badRequest(`Некорректный период: ${periodKey}. Допустимые: ${Object.keys(PERIOD_MS).join(", ")}`);
  }

  // Проверка кэша.
  const cacheKey = `${symbol}:${exchange}:${periodKey}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.data);
  }

  const toMs = Date.now();
  const fromMs = toMs - periodMs;

  try {
    const [imbalance, speedOfTape] = await Promise.all([
      computeImbalance(symbol, exchange, fromMs, toMs),
      computeSpeedOfTape(symbol, exchange, fromMs, toMs),
    ]);

    const payload = {
      symbol,
      exchange,
      period: periodKey,
      from: fromMs,
      to: toMs,
      imbalance,
      speedOfTape,
    };

    cache.set(cacheKey, { at: Date.now(), data: payload });
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[imbalance] error:", e);
    return serverError("Ошибка вычисления Imbalance/Speed of Tape");
  }
}