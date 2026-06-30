import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, sharedCacheHeaders } from "@/lib/api";

export const maxDuration = 20;

// Symbol list barely changes; cache an hour at the edge.
const CACHE = sharedCacheHeaders(3600, 86400);

// All tradable USDT perpetual symbols (from Binance futures), cached for an hour.
let cache: { at: number; symbols: string[] } | null = null;
const TTL_MS = 60 * 60 * 1000;
const UA = "Mozilla/5.0 (compatible; TradeStatsBot/1.0; +https://tradingstat.ru)";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ symbols: cache.symbols }, { headers: CACHE });
  }
  try {
    const res = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo", {
      headers: { "user-agent": UA, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      symbols?: { symbol: string; status: string; contractType: string; quoteAsset: string }[];
    };
    const symbols = (data.symbols ?? [])
      .filter(
        (s) => s.status === "TRADING" && s.contractType === "PERPETUAL" && s.quoteAsset === "USDT",
      )
      .map((s) => s.symbol)
      .sort();
    cache = { at: Date.now(), symbols };
    return NextResponse.json({ symbols }, { headers: CACHE });
  } catch {
    // Fall back to a small built-in list so the UI still works.
    if (cache) return NextResponse.json({ symbols: cache.symbols }, { headers: CACHE });
    return NextResponse.json({
      symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"],
    });
  }
}
