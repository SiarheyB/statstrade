import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { computeDivergence } from "@/lib/orderflow";

export const maxDuration = 30;

// Периоды для Divergence Scanner: ключ → длительность в мс.
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
const DEFAULT_MIN_STRENGTH = 2;
const DEFAULT_LOOKBACK = 50;

// Кэш ответа (TTL 12с, как в основном /api/orderflow).
const TTL_MS = 12000;
const cache = new Map<string, { at: number; data: unknown }>();

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const exchange = (url.searchParams.get("exchange") ?? "binance-futures").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const periodKey = url.searchParams.get("period") ?? DEFAULT_PERIOD;
  const minStrengthParam = url.searchParams.get("minStrength");
  const lookbackParam = url.searchParams.get("lookbackBars");

  // Валидация символа.
  if (symbol.length < 5) {
    return badRequest("Некорректный символ: минимальная длина 5 символов");
  }

  // Валидация period.
  const periodMs = PERIOD_MS[periodKey];
  if (!periodMs) {
    return badRequest(`Некорректный период: ${periodKey}. Допустимые: ${Object.keys(PERIOD_MS).join(", ")}`);
  }

  // Валидация minStrength.
  let minStrength = DEFAULT_MIN_STRENGTH;
  if (minStrengthParam) {
    minStrength = parseInt(minStrengthParam, 10);
    if (Number.isNaN(minStrength) || minStrength < 1 || minStrength > 5) {
      return badRequest("minStrength должен быть числом от 1 до 5");
    }
  }

  // Валидация lookbackBars.
  let lookbackBars = DEFAULT_LOOKBACK;
  if (lookbackParam) {
    lookbackBars = parseInt(lookbackParam, 10);
    if (Number.isNaN(lookbackBars) || lookbackBars < 10 || lookbackBars > 200) {
      return badRequest("lookbackBars должен быть числом от 10 до 200");
    }
  }

  // Проверка кэша.
  const cacheKey = `${symbol}:${exchange}:${periodKey}:${minStrength}:${lookbackBars}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.data);
  }

  const toMs = Date.now();
  const fromMs = toMs - periodMs;

  try {
    const result = await computeDivergence(symbol, exchange, "1h", fromMs, toMs, {
      minStrength,
      lookbackBars,
      minDivergenceBars: 5,
      maxDivergenceBars: 30,
    });

    const payload = {
      symbol,
      exchange,
      period: periodKey,
      from: fromMs,
      to: toMs,
      divergence: result,
    };

    // Кэшируем.
    cache.set(cacheKey, { at: Date.now(), data: payload });

    return NextResponse.json(payload);
  } catch (e) {
    console.error("[divergence] error:", e);
    return serverError("Ошибка вычисления Divergence Scanner");
  }
}