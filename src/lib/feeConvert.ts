// Конвертация комиссий в фи-токенах (BNB, OKB, KCS, GT, MX…) в котируемую
// валюту филла — иначе аналитика считает такую комиссию нулём и завышает PnL.
//
// Работает на этапе записи (persistFills), один раз на филл. Только для
// USD-стейбловых котировок (подавляющее большинство пар): курс = дневной close
// FEEUSDT с публичного Binance API на дату филла. Комиссии — центы/доллары,
// дневной точности более чем достаточно. Кэш (валюта|день) в памяти, включая
// негативные ответы; сетевые ошибки не кэшируются и не фатальны — филл остаётся
// с исходной валютой (поведение как раньше: комиссия не учтётся).

import type { NormalizedFill } from "./exchanges";

const STABLE_QUOTES = new Set(["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "USD", "DAI"]);
// Стейбл-комиссия на стейбл-котировке — 1:1 без сети.
const STABLE_FEES = STABLE_QUOTES;
// Не больше стольких сетевых курсов за один batch (один вызов persistFills).
const MAX_LOOKUPS_PER_BATCH = 25;

const dayOf = (t: Date) => Math.floor(t.getTime() / 86_400_000) * 86_400_000;

// `${currency}:${dayMs}` -> close (null = Binance ответил «нет такой пары»).
const priceCache = new Map<string, number | null>();

async function dailyCloseUsd(currency: string, dayMs: number): Promise<number | null> {
  const key = `${currency}:${dayMs}`;
  const hit = priceCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const url =
      `https://api.binance.com/api/v3/klines?symbol=${currency}USDT` +
      `&interval=1d&startTime=${dayMs}&limit=1`;
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 400) {
      // Пары нет на Binance — запоминаем, чтобы не долбить на каждом батче.
      priceCache.set(key, null);
      return null;
    }
    if (!res.ok) return null; // временная ошибка — не кэшируем
    const raw = (await res.json()) as unknown[][];
    const close = Number(raw?.[0]?.[4]);
    const val = Number.isFinite(close) && close > 0 ? close : null;
    priceCache.set(key, val);
    return val;
  } catch {
    return null; // сеть/таймаут — не кэшируем, попробуем в следующем батче
  }
}

// Пересчитать (in place) комиссии филлов, чья валюта не base/quote, в котируемую
// валюту. После конвертации feeCurrency = quote — дальше feeInQuote берёт её как
// есть. Неконвертируемые случаи (не-стейбл котировка, нет курса) не трогаем.
export async function convertUnknownFees(fills: NormalizedFill[]): Promise<void> {
  const pending: NormalizedFill[] = [];
  for (const f of fills) {
    if (!f.fee || !f.feeCurrency) continue;
    if (f.feeCurrency === f.quote || f.feeCurrency === f.base) continue; // feeInQuote справится
    if (!STABLE_QUOTES.has(f.quote)) continue; // курс к не-стейблу не считаем
    if (STABLE_FEES.has(f.feeCurrency)) {
      // Стейбл в стейбл: 1:1.
      f.feeCurrency = f.quote;
      continue;
    }
    pending.push(f);
  }
  if (pending.length === 0) return;

  // Уникальные (валюта, день) — обычно 1-2 на батч (BNB × дни).
  const needed = new Map<string, { currency: string; dayMs: number }>();
  for (const f of pending) {
    const dayMs = dayOf(f.timestamp);
    needed.set(`${f.feeCurrency}:${dayMs}`, { currency: f.feeCurrency!, dayMs });
  }
  const rates = new Map<string, number>();
  let lookups = 0;
  for (const [key, { currency, dayMs }] of needed) {
    if (priceCache.get(key) === undefined && lookups >= MAX_LOOKUPS_PER_BATCH) continue;
    if (priceCache.get(key) === undefined) lookups += 1;
    const close = await dailyCloseUsd(currency, dayMs);
    if (close != null) rates.set(key, close);
  }

  for (const f of pending) {
    const rate = rates.get(`${f.feeCurrency}:${dayOf(f.timestamp)}`);
    if (rate == null) continue;
    f.fee = f.fee * rate;
    f.feeCurrency = f.quote;
  }
}
