import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { computeVolumeProfile } from "@/lib/orderflow";

export const maxDuration = 30;

// Периоды для Volume Profile: ключ → длительность в мс.
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
const DEFAULT_BINS = 100;
const DEFAULT_VALUE_AREA_PCT = 0.7;

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
  const binsParam = url.searchParams.get("bins");
  const valueAreaPctParam = url.searchParams.get("valueAreaPct");

  // Валидация символа.
  if (symbol.length < 5) {
    return badRequest("Некорректный символ: минимальная длина 5 символов");
  }

  // Валидация period.
  const periodMs = PERIOD_MS[periodKey];
  if (!periodMs) {
    return badRequest(`Некорректный период: ${periodKey}. Допустимые: ${Object.keys(PERIOD_MS).join(", ")}`);
  }

  // Валидация bins.
  let bins = DEFAULT_BINS;
  if (binsParam) {
    bins = parseInt(binsParam, 10);
    if (Number.isNaN(bins) || bins < 10 || bins > 500) {
      return badRequest("bins должен быть числом от 10 до 500");
    }
  }

  // Валидация valueAreaPct.
  let valueAreaPct = DEFAULT_VALUE_AREA_PCT;
  if (valueAreaPctParam) {
    valueAreaPct = parseFloat(valueAreaPctParam);
    if (Number.isNaN(valueAreaPct) || valueAreaPct < 0.1 || valueAreaPct > 0.99) {
      return badRequest("valueAreaPct должен быть числом от 0.1 до 0.99");
    }
  }

  // Проверка кэша.
  const cacheKey = `${symbol}:${exchange}:${periodKey}:${bins}:${valueAreaPct}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.data);
  }

  const toMs = Date.now();
  const fromMs = toMs - periodMs;

  try {
    const result = await computeVolumeProfile(symbol, exchange, fromMs, toMs, {
      bins,
      valueAreaPct,
    });

    const payload = {
      symbol,
      exchange,
      period: periodKey,
      from: fromMs,
      to: toMs,
      volumeProfile: result,
    };

    // Кэшируем.
    cache.set(cacheKey, { at: Date.now(), data: payload });

    return NextResponse.json(payload);
  } catch (e) {
    console.error("[volume-profile] error:", e);
    return serverError("Ошибка вычисления Volume Profile");
  }
}