import { NextResponse } from "next/server";
import { getAuthUser, unauthorized } from "@/lib/api";
import { forexAccessError } from "@/lib/forexAccess";
import { prisma } from "@/lib/db";

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
  // Металлы: формально не валютные пары, но торгуются и отображаются так же.
  // Данные по ним идут из Dukascopy (см. collector/forex/dukascopy.mjs).
  "XAU/USD": { base: "XAU", quote: "USD", label: "Gold / US Dollar" },
  "XAG/USD": { base: "XAG", quote: "USD", label: "Silver / US Dollar" },
};

/** Список пар из ENV FX_SYMBOLS (фоллбек, если в БД ничего не настроено). */
function envSymbols() {
  return (process.env.FX_SYMBOLS ?? "EUR/USD,GBP/USD,USD/JPY,USD/CHF,AUD/USD,NZD/USD,XAU/USD")
    .split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * Источник истины тот же, что у коллектора: включённые пары из
 * FxCollectorConfig, а если таблица пуста — ENV FX_SYMBOLS
 * (см. collector/forex/index.mjs, syncSymbolsFromConfig).
 *
 * Раньше список брался только из ENV, и пара, добавленная через админку
 * (/admin/forex), собиралась коллектором, но в выпадающем списке на графике не
 * появлялась — до передеплоя с новым FX_SYMBOLS.
 */
async function getPairs() {
  let symbols: string[] = [];
  try {
    const rows = await prisma.fxCollectorConfig.findMany({
      where: { enabled: true },
      orderBy: { symbol: "asc" },
      select: { symbol: true },
    });
    symbols = rows.map(r => r.symbol);
  } catch {
    // БД недоступна — не роняем график, отдаём то, что знаем из ENV.
  }
  if (symbols.length === 0) symbols = envSymbols();

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

export async function GET(_req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const denied = await forexAccessError(user);
  if (denied) return denied;

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.data);
  }

  const data = { pairs: await getPairs() };
  cache = { at: Date.now(), data };
  return NextResponse.json(data);
}