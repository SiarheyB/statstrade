import { NextResponse } from "next/server";
import { getAuthUser, unauthorized } from "@/lib/api";
import { forexAccessError } from "@/lib/forexAccess";

// Карта известных валютных пар для генерации label.
const KNOWN_PAIRS: Record<string, { base: string; quote: string; label: string }> = {
  "EUR/USD": { base: "EUR", quote: "USD", label: "Euro / US Dollar" },
  "GBP/USD": { base: "GBP", quote: "USD", label: "British Pound / US Dollar" },
  "USD/JPY": { base: "USD", quote: "JPY", label: "US Dollar / Japanese Yen" },
  "USD/CHF": { base: "USD", quote: "CHF", label: "US Dollar / Swiss Franc" },
  "AUD/USD": { base: "AUD", quote: "USD", label: "Australian Dollar / US Dollar" },
  "NZD/USD": { base: "NZD", quote: "USD", label: "New Zealand Dollar / US Dollar" },
  "EUR/JPY": { base: "EUR", quote: "JPY", label: "Euro / Japanese Yen" },
  "GBP/JPY": { base: "GBP", quote: "JPY", label: "British Pound / Japanese Yen" },
};

/**
 * Получить список пар из FX_SYMBOLS (тот же env, что и для коллектора).
 * Если не задан — используется дефолтный набор мажоров.
 */
function getPairs() {
  const symbols = (process.env.FX_SYMBOLS ?? "EUR/USD,GBP/USD,USD/JPY,USD/CHF,AUD/USD,NZD/USD")
    .split(",").map(s => s.trim()).filter(Boolean);

  return symbols.map(sym => {
    const known = KNOWN_PAIRS[sym];
    if (known) return { symbol: sym, ...known };
    // Если пара не в KNOWN_PAIRS — генерируем base/quote из формата XXX/YYY
    const parts = sym.split("/");
    return {
      symbol: sym,
      base: parts[0] ?? sym,
      quote: parts[1] ?? "",
      label: parts.length === 2 ? `${parts[0]} / ${parts[1]}` : sym,
    };
  });
}

const TTL_MS = 60_000;
let cache: { at: number; data: unknown } | null = null;

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const denied = await forexAccessError(user);
  if (denied) return denied;

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.data);
  }

  const data = { pairs: getPairs() };
  cache = { at: Date.now(), data };
  return NextResponse.json(data);
}