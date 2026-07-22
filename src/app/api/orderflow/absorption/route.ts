/**
 * GET /api/orderflow/absorption — Absorption Pattern Detector
 *
 * Ищет паттерны накопления/распределения: узкий диапазон + аномальный объём +
 * дельта около нуля. Использует ObFootprint (buyVol, sellVol) и ObCandle.
 *
 * Query: symbol, exchange, period, minVolumeMultiplier, maxRangeBars,
 *        maxDeltaRatio, minCandles, lookback
 * Auth: session
 * Cache: 12s TTL
 */

import { NextResponse } from 'next/server';
import { getAuthUser, unauthorized, badRequest, serverError } from '@/lib/api';
import { computeAbsorption } from '@/lib/orderflow';

export const maxDuration = 30;

const PERIODS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '7d': 604_800_000,
};

// 12s TTL cache
const cache = new Map<string, { data: unknown; until: number }>();

export async function GET(req: Request) {
  // 1. Auth
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);

  // 2. Cache check
  const cacheKey = url.searchParams.toString();
  const cached = cache.get(cacheKey);
  if (cached && cached.until > Date.now()) {
    return NextResponse.json(cached.data);
  }

  // 3. Params
  const searchParams = url.searchParams;
  const symbol = searchParams.get('symbol')?.toUpperCase();
  const exchange = searchParams.get('exchange') ?? 'binance';
  const period = searchParams.get('period') ?? '5m';
  const minVolumeMultiplier = parseFloat(searchParams.get('minVolumeMultiplier') ?? '2');
  const maxRangeBars = parseFloat(searchParams.get('maxRangeBars') ?? '3');
  const maxDeltaRatio = parseFloat(searchParams.get('maxDeltaRatio') ?? '0.15');
  const minCandles = parseInt(searchParams.get('minCandles') ?? '2', 10);
  const lookback = parseInt(searchParams.get('lookback') ?? '10', 10);

  if (!symbol) return badRequest('symbol is required');
  if (!/^[A-Z0-9-]+$/.test(symbol)) return badRequest('invalid symbol');
  if (!PERIODS[period]) return badRequest(`invalid period, must be one of: ${Object.keys(PERIODS).join(', ')}`);

  // 4. Time range
  const toMs = Date.now();
  const fromMs = toMs - PERIODS[period] * 100;

  try {
    const result = await computeAbsorption(
      symbol,
      exchange,
      period,
      fromMs,
      toMs,
      { minVolumeMultiplier, maxRangeBars, maxDeltaRatio, minCandles, lookback },
    );

    const data = {
      symbol,
      exchange,
      period,
      from: fromMs,
      to: toMs,
      absorption: result,
    };

    // 5. Cache
    cache.set(cacheKey, { data, until: Date.now() + 12_000 });

    return NextResponse.json(data);
  } catch (error) {
    console.error('[absorption]', error);
    return serverError('Internal server error');
  }
}