// Liquidation heatmap — a CoinGlass-style estimate built from public futures
// candles (no API key, no persistent socket; works on serverless).
//
// Method (the standard "leverage-line" model):
//  - Each candle approximates positions opened around its close, sized by the
//    candle's quote volume (a proxy for notional opened).
//  - For a set of leverage tiers, every position has a liquidation price:
//        long  liq = entry · (1 − (1/L − mmr))
//        short liq = entry · (1 + (1/L − mmr))
//  - That liquidation "magnitude" sits at its price level on the time axis from
//    when it was opened until price first touches the level (it gets swept —
//    the bright bands that disappear when price runs through them).
//  - Summing all active levels over a price × time grid gives the heatmap.
// It is an estimate (volume proxy + assumed leverage mix), exactly like every
// such heatmap, CoinGlass included.

export type Exchange = "binance" | "bybit" | "okx";
export type Timeframe = "1d" | "2d" | "7d" | "1M" | "3M";

export type Kline = {
  time: number; // ms
  open: number;
  high: number;
  low: number;
  close: number;
  quoteVol: number; // quote-currency volume (notional proxy)
};

// Leverage tiers and their relative share of each candle's volume. Heavier on
// the common retail tiers; tweakable in one place.
const LEVERAGES: { lev: number; weight: number }[] = [
  { lev: 10, weight: 0.6 },
  { lev: 25, weight: 1.0 },
  { lev: 50, weight: 1.0 },
  { lev: 100, weight: 0.8 },
];
const MMR = 0.004; // maintenance margin ~0.4%

const TF: Record<Timeframe, { binance: string; bybit: string; okx: string; limit: number }> = {
  "1d": { binance: "15m", bybit: "15", okx: "15m", limit: 96 },
  "2d": { binance: "30m", bybit: "30", okx: "30m", limit: 96 },
  "7d": { binance: "1h", bybit: "60", okx: "1H", limit: 168 },
  "1M": { binance: "4h", bybit: "240", okx: "4H", limit: 180 },
  "3M": { binance: "1d", bybit: "D", okx: "1D", limit: 90 },
};

const UA = "Mozilla/5.0 (compatible; TradeStatsBot/1.0; +https://statstrade.vercel.app)";

function splitSymbol(symbol: string): { base: string; quote: string } {
  const s = symbol.toUpperCase();
  for (const q of ["USDT", "USDC", "USD"]) {
    if (s.endsWith(q)) return { base: s.slice(0, -q.length), quote: q };
  }
  return { base: s, quote: "USDT" };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`${url.split("?")[0]} HTTP ${res.status}`);
  return res.json();
}

// --- Per-exchange kline fetchers (public USDⓈ-M perps), oldest → newest. ---

async function binanceKlines(symbol: string, tf: Timeframe): Promise<Kline[]> {
  const { binance: interval, limit } = TF[tf];
  const raw = (await getJson(
    `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  )) as unknown[][];
  return raw.map((k) => ({
    time: Number(k[0]),
    open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]),
    quoteVol: Number(k[7]),
  }));
}

async function bybitKlines(symbol: string, tf: Timeframe): Promise<Kline[]> {
  const { bybit: interval, limit } = TF[tf];
  const data = (await getJson(
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`,
  )) as { result?: { list?: string[][] } };
  const list = data.result?.list ?? [];
  return list
    .map((k) => ({
      time: Number(k[0]),
      open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]),
      quoteVol: Number(k[6]), // turnover (quote volume)
    }))
    .reverse();
}

async function okxKlines(symbol: string, tf: Timeframe): Promise<Kline[]> {
  const { okx: bar, limit } = TF[tf];
  const { base, quote } = splitSymbol(symbol);
  const instId = `${base}-${quote}-SWAP`;
  const data = (await getJson(
    `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${Math.min(limit, 300)}`,
  )) as { data?: string[][] };
  return (data.data ?? [])
    .map((k) => ({
      time: Number(k[0]),
      open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]),
      quoteVol: Number(k[7]), // volCcyQuote
    }))
    .reverse();
}

export async function fetchKlines(exchange: Exchange, symbol: string, tf: Timeframe): Promise<Kline[]> {
  if (exchange === "binance") return binanceKlines(symbol, tf);
  if (exchange === "bybit") return bybitKlines(symbol, tf);
  return okxKlines(symbol, tf);
}

export type Heatmap = {
  priceMin: number;
  priceMax: number;
  bins: number;
  cols: number;
  grid: number[][]; // [col][bin] intensity
  maxVal: number;
  price: number; // current (last close)
  candles: { t: number; o: number; h: number; l: number; c: number }[];
};

// Build the heatmap grid from klines. An optional fixed price range lets several
// exchanges be summed onto the same axis (aggregate view).
export function buildHeatmap(
  klines: Kline[],
  opts: { bins?: number; cols?: number; range?: [number, number] } = {},
): Heatmap | null {
  const n = klines.length;
  if (n === 0) return null;
  const bins = opts.bins ?? 160;
  const cols = Math.min(opts.cols ?? 140, n);

  let pMin = opts.range?.[0] ?? Math.min(...klines.map((k) => k.low));
  let pMax = opts.range?.[1] ?? Math.max(...klines.map((k) => k.high));
  if (!opts.range) {
    const pad = (pMax - pMin) * 0.06 || pMax * 0.01;
    pMin -= pad;
    pMax += pad;
  }
  const span = pMax - pMin || 1;
  const binOf = (p: number) => Math.floor(((p - pMin) / span) * bins);
  const colOf = (i: number) => Math.min(cols - 1, Math.floor((i / n) * cols));

  const grid: number[][] = Array.from({ length: cols }, () => new Array(bins).fill(0));

  for (let i = 0; i < n; i++) {
    const entry = klines[i].close;
    const size = klines[i].quoteVol;
    if (!size || !entry) continue;
    for (const { lev, weight } of LEVERAGES) {
      const dist = 1 / lev - MMR;
      if (dist <= 0) continue;
      for (const side of [-1, 1] as const) {
        const liq = side < 0 ? entry * (1 - dist) : entry * (1 + dist);
        const bin = binOf(liq);
        if (bin < 0 || bin >= bins) continue;
        // First candle after i where price touches the level → it's swept.
        let hit = n;
        for (let t = i + 1; t < n; t++) {
          if (side < 0 ? klines[t].low <= liq : klines[t].high >= liq) {
            hit = t;
            break;
          }
        }
        const w = size * weight;
        const cEnd = colOf(Math.max(i, hit - 1));
        for (let c = colOf(i); c <= cEnd; c++) grid[c][bin] += w;
      }
    }
  }

  let maxVal = 0;
  for (const col of grid) for (const v of col) if (v > maxVal) maxVal = v;

  return {
    priceMin: pMin,
    priceMax: pMax,
    bins,
    cols,
    grid,
    maxVal,
    price: klines[n - 1].close,
    candles: klines.map((k) => ({ t: k.time, o: k.open, h: k.high, l: k.low, c: k.close })),
  };
}

// Compute the heatmap for one exchange, or aggregate all three onto a shared
// price range (summing the grids).
export async function computeLiqMap(
  exchange: Exchange | "all",
  symbol: string,
  tf: Timeframe,
): Promise<Heatmap | null> {
  if (exchange !== "all") {
    return buildHeatmap(await fetchKlines(exchange, symbol, tf));
  }

  const exchanges: Exchange[] = ["binance", "bybit", "okx"];
  const sets = await Promise.allSettled(exchanges.map((e) => fetchKlines(e, symbol, tf)));
  const ok = sets.filter((s) => s.status === "fulfilled" && s.value.length > 0) as PromiseFulfilledResult<Kline[]>[];
  if (ok.length === 0) return null;

  const all = ok.flatMap((s) => s.value);
  const range: [number, number] = [
    Math.min(...all.map((k) => k.low)) * 0.99,
    Math.max(...all.map((k) => k.high)) * 1.01,
  ];
  let combined: Heatmap | null = null;
  for (const s of ok) {
    const hm = buildHeatmap(s.value, { range });
    if (!hm) continue;
    if (!combined) combined = hm;
    else {
      for (let c = 0; c < combined.cols; c++)
        for (let b = 0; b < combined.bins; b++) combined.grid[c][b] += hm.grid[c]?.[b] ?? 0;
    }
  }
  if (combined) {
    let maxVal = 0;
    for (const col of combined.grid) for (const v of col) if (v > maxVal) maxVal = v;
    combined.maxVal = maxVal;
  }
  return combined;
}
