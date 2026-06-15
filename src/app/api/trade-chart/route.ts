import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest } from "@/lib/api";
import { getPublicExchange, isExchangeId, type MarketKind } from "@/lib/exchanges";

export const maxDuration = 30;

const TF_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

function pickTimeframe(spanMs: number): string {
  if (spanMs < 3 * 3_600_000) return "1m";
  if (spanMs < 12 * 3_600_000) return "5m";
  if (spanMs < 2 * 86_400_000) return "15m";
  if (spanMs < 10 * 86_400_000) return "1h";
  if (spanMs < 60 * 86_400_000) return "4h";
  return "1d";
}

// Returns OHLCV candles around a trade's time window for the hover preview.
// Uses public market data (no API keys needed).
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const exchange = url.searchParams.get("exchange") ?? "";
  const symbol = url.searchParams.get("symbol") ?? "";
  const market = url.searchParams.get("market") ?? "spot";
  const from = Number(url.searchParams.get("from"));
  const to = Number(url.searchParams.get("to"));

  if (!isExchangeId(exchange)) return badRequest("Неподдерживаемая биржа");
  if (!symbol) return badRequest("Не указан символ");
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return badRequest("Некорректный временной диапазон");
  }

  const durationMs = Math.max(to - from, 60_000);
  const pad = Math.max(durationMs * 0.3, 30 * 60_000);
  const start = from - pad;
  const end = to + pad;
  const span = end - start;
  const tf = pickTimeframe(span);
  const limit = Math.min(500, Math.ceil(span / TF_MS[tf]) + 5);

  const kind: MarketKind = market === "spot" ? "spot" : "swap";

  try {
    const ex = await getPublicExchange(exchange, kind);
    if (!ex.has["fetchOHLCV"]) {
      return NextResponse.json({ candles: [], timeframe: tf });
    }
    const raw = (await ex.fetchOHLCV(symbol, tf, Math.floor(start), limit)) as number[][];
    const candles = raw
      .filter((c) => c[0] >= start && c[0] <= end)
      .map((c) => [c[0], c[1], c[2], c[3], c[4]]);
    return NextResponse.json({ candles, timeframe: tf });
  } catch (err) {
    // Market data unavailable (geo-block, delisted symbol, rate limit...) —
    // the client falls back to a schematic chart.
    return NextResponse.json(
      { candles: [], timeframe: tf, error: (err as Error).message },
      { status: 200 },
    );
  }
}
