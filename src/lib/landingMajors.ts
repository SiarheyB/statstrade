/**
 * landingMajors.ts — блок «Старшие монеты» на главной странице: цена, дневной
 * график и (для BTC/ETH) ближайшая крупная заявка в стакане.
 *
 * Стакан (ObSnapshotRollup) собирается ТОЛЬКО по символам из OB_SYMBOLS —
 * на проде это BTCUSDT/ETHUSDT (см. docker-compose.prod.yml). Для остальных
 * монет есть только дневные свечи (OB_SCAN_ALL_USDT_PAIRS, тот же источник,
 * что у /dashboard/recommendations) — у них стены нет и не будет, пока
 * коллектор не соберёт для них стакан. wall остаётся null, а не выдумывается
 * из дневных данных: показать несуществующую заявку — хуже, чем не показать
 * никакой.
 */
import { prisma } from "./db";

const EXCHANGE = "binance-futures";
const CANDLE_COUNT = 24;
// Кому вообще пробуем искать стену — остальные символы даже не идут в БД за
// ObSnapshotRollup, там заведомо пусто (см. комментарий выше).
const WALL_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT"]);
// Бакет стакана свежий — иначе на простаивающем коллекторе показали бы стену
// многочасовой давности как «сейчас».
const WALL_FRESH_MS = 15 * 60_000;
// Шум мелких лимиток отсекаем по нотионалу, а не по количеству монет — то же,
// что bigLimitFor в dashboard/orderflow, но с одним порогом на все монеты:
// здесь это не карта ордеров с посвящённым читателем, а беглый взгляд с
// главной, и он не должен доверять монете-мелочи то же, что доверяет BTC.
const MIN_WALL_USD = 300_000;
const TICKER_URL = "https://fapi.binance.com/fapi/v1/ticker/24hr";
const FETCH_TIMEOUT_MS = 8_000;

export const MAJOR_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];

export interface MajorCandle {
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface MajorWall {
  side: "buy" | "sell";
  /** Расстояние от текущей цены в процентах — уже в плюс, направление в `side`. */
  distPct: number;
  /** Объём заявки в долларах (объём в монете × цена уровня). */
  volUsd: number;
}

export interface MajorCoin {
  symbol: string;
  price: number;
  changePct: number;
  candles: MajorCandle[];
  wall: MajorWall | null;
}

async function fetchTickers(symbols: string[]): Promise<Map<string, { price: number; changePct: number }>> {
  const out = new Map<string, { price: number; changePct: number }>();
  try {
    const res = await fetch(TICKER_URL, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return out;
    const raw = (await res.json()) as { symbol?: string; lastPrice?: string; priceChangePercent?: string }[];
    const wanted = new Set(symbols);
    for (const row of Array.isArray(raw) ? raw : []) {
      if (!row.symbol || !wanted.has(row.symbol)) continue;
      const price = Number(row.lastPrice);
      const changePct = Number(row.priceChangePercent);
      if (Number.isFinite(price) && price > 0) out.set(row.symbol, { price, changePct: Number.isFinite(changePct) ? changePct : 0 });
    }
  } catch {
    // Binance недоступен — монета просто не попадёт в выдачу (см. loadMajors),
    // а не покажет нулевую/битую цену.
  }
  return out;
}

async function loadCandles(symbol: string): Promise<MajorCandle[]> {
  const rows = await prisma.obCandle.findMany({
    where: { symbol, exchange: EXCHANGE, interval: "1d" },
    orderBy: { t: "desc" },
    take: CANDLE_COUNT,
    select: { o: true, h: true, l: true, c: true },
  });
  return rows.reverse();
}

/**
 * Ближайшая крупная заявка в стакане относительно текущей цены: самый
 * толстый ask-бин выше цены (стена продажи) и самый толстый bid-бин ниже
 * (стена покупки) — из них берём ту, что крупнее в деньгах.
 */
async function loadWall(symbol: string, currentPrice: number): Promise<MajorWall | null> {
  if (!WALL_SYMBOLS.has(symbol)) return null;

  const latest = await prisma.obSnapshotRollup.findFirst({
    where: { symbol, exchange: EXCHANGE },
    orderBy: { bucket: "desc" },
    select: { bucket: true },
  });
  if (!latest || Date.now() - latest.bucket.getTime() > WALL_FRESH_MS) return null;

  const rows = await prisma.obSnapshotRollup.findMany({
    where: { symbol, exchange: EXCHANGE, bucket: latest.bucket },
    select: { price: true, bidSum: true, askSum: true },
  });
  if (!rows.length) return null;

  let bestSell: { price: number; vol: number } | null = null;
  let bestBuy: { price: number; vol: number } | null = null;
  for (const r of rows) {
    if (r.price > currentPrice && r.askSum > 0 && (!bestSell || r.askSum > bestSell.vol)) {
      bestSell = { price: r.price, vol: r.askSum };
    }
    if (r.price < currentPrice && r.bidSum > 0 && (!bestBuy || r.bidSum > bestBuy.vol)) {
      bestBuy = { price: r.price, vol: r.bidSum };
    }
  }

  const candidates: { side: "buy" | "sell"; price: number; volUsd: number }[] = [];
  if (bestSell) candidates.push({ side: "sell", price: bestSell.price, volUsd: bestSell.vol * bestSell.price });
  if (bestBuy) candidates.push({ side: "buy", price: bestBuy.price, volUsd: bestBuy.vol * bestBuy.price });
  if (!candidates.length) return null;

  const top = candidates.sort((a, b) => b.volUsd - a.volUsd)[0];
  if (top.volUsd < MIN_WALL_USD) return null;

  return {
    side: top.side,
    volUsd: top.volUsd,
    distPct: (Math.abs(top.price - currentPrice) / currentPrice) * 100,
  };
}

export async function loadMajors(): Promise<MajorCoin[]> {
  const tickers = await fetchTickers(MAJOR_SYMBOLS);
  if (tickers.size === 0) return [];

  const rows = await Promise.all(
    MAJOR_SYMBOLS.map(async (symbol) => {
      const ticker = tickers.get(symbol);
      // Тикер не ответил по этой монете — не показываем её вовсе: цена
      // «застывшая на прошлый заход» хуже отсутствующей строки.
      if (!ticker) return null;
      const [candles, wall] = await Promise.all([loadCandles(symbol), loadWall(symbol, ticker.price)]);
      const coin: MajorCoin = { symbol, price: ticker.price, changePct: ticker.changePct, candles, wall };
      return coin;
    }),
  );
  return rows.filter((c): c is MajorCoin => c !== null);
}
