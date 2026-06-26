// Orderbook heatmap — построение грида из снапшотов, собранных collector-сервисом
// (таблица ObSnapshot). В отличие от liqmap (синтетика из свечей), здесь реальные
// исторические данные стакана: X — время, Y — цена, интенсивность — объём лимиток
// (bid+ask) на ценовом уровне. «Стены» крупных игроков светятся и гаснут.

import { prisma } from "@/lib/db";

export type ObHeatmap = {
  priceMin: number;
  priceMax: number;
  bins: number;
  cols: number;
  grid: number[][]; // [col][bin] средняя интенсивность (base units)
  maxVal: number;
  price: number; // последняя mid (центр последнего снапшота)
  times: number[]; // ms-таймстемпы колонок (длина = cols)
};

type Row = { t: Date; price: number; bidVol: number; askVol: number; exchange?: string };

// Собрать грид из строк снапшотов. Колонки — равномерные корзины времени в
// [fromMs, toMs], бины — ценовые уровни. Значение ячейки = средняя по снапшотам
// ликвидность (bid+ask); при нескольких биржах их средние суммируются, чтобы
// колонки совпадали по времени и агрегат отражал совокупный стакан.
export function buildOrderflowHeatmap(
  rows: Row[],
  fromMs: number,
  toMs: number,
  opts: { bins?: number; cols?: number } = {},
): ObHeatmap | null {
  if (rows.length === 0) return null;
  const bins = opts.bins ?? 160;
  const cols = opts.cols ?? 240;
  const xspan = toMs - fromMs || 1;
  const colOf = (t: number) => Math.max(0, Math.min(cols - 1, Math.floor(((t - fromMs) / xspan) * cols)));

  let pMin = Math.min(...rows.map((r) => r.price));
  let pMax = Math.max(...rows.map((r) => r.price));
  const pad = (pMax - pMin) * 0.02 || pMax * 0.005;
  pMin -= pad;
  pMax += pad;
  const span = pMax - pMin || 1;
  const binOf = (p: number) => Math.max(0, Math.min(bins - 1, Math.floor(((p - pMin) / span) * bins)));

  const grid: number[][] = Array.from({ length: cols }, () => new Array(bins).fill(0));
  // Для усреднения: число различных снапшотов (exchange|t) в колонке и набор бирж.
  const instants: Set<string>[] = Array.from({ length: cols }, () => new Set());
  const exchangesInCol: Set<string>[] = Array.from({ length: cols }, () => new Set());

  for (const r of rows) {
    const ts = r.t.getTime();
    const c = colOf(ts);
    const b = binOf(r.price);
    grid[c][b] += r.bidVol + r.askVol;
    const ex = r.exchange ?? "_";
    instants[c].add(`${ex}|${ts}`);
    exchangesInCol[c].add(ex);
  }
  for (let c = 0; c < cols; c++) {
    const n = instants[c].size || 1;
    const exCount = exchangesInCol[c].size || 1;
    // sum/n = средняя по всем снапшотам; ×exCount ≈ сумма средних по биржам.
    const k = exCount / n;
    for (let b = 0; b < bins; b++) grid[c][b] *= k;
  }

  let maxVal = 0;
  for (const col of grid) for (const v of col) if (v > maxVal) maxVal = v;

  // Таймстемп каждой колонки — центр корзины.
  const times = new Array(cols).fill(0).map((_, c) => Math.round(fromMs + ((c + 0.5) / cols) * xspan));

  // Текущая цена — из самого свежего снапшота.
  const lastT = Math.max(...rows.map((r) => r.t.getTime()));
  const lastRows = rows.filter((r) => r.t.getTime() === lastT);
  const price = lastRows.length
    ? lastRows.reduce((s, r) => s + r.price, 0) / lastRows.length
    : rows[rows.length - 1].price;

  return { priceMin: pMin, priceMax: pMax, bins, cols, grid, maxVal, price, times };
}

export type OfCandle = { t: number; o: number; h: number; l: number; c: number };

// Интервал свечей под диапазон просмотра.
const CANDLE_INTERVAL: Record<string, string> = {
  "15m": "1m",
  "1h": "1m",
  "4h": "5m",
  "24h": "30m",
};

// Свечи для наложения поверх heatmap. Пока только Binance USDⓈ-M Futures
// (как и collector); другие биржи добавим вместе с мультибиржевым сбором.
// Свечи как ценовой референс берём с Binance USDⓈ-M Futures независимо от
// выбранной биржи стакана (цена BTC/ETH практически совпадает между площадками).
export async function fetchOrderflowCandles(
  symbol: string,
  _exchange: string,
  range: string,
  fromMs: number,
  toMs: number,
): Promise<OfCandle[]> {
  const interval = CANDLE_INTERVAL[range] ?? "1m";
  const url =
    `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}` +
    `&interval=${interval}&startTime=${fromMs}&endTime=${toMs}&limit=1500`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const raw = (await res.json()) as unknown[][];
    return raw.map((k) => ({
      t: Number(k[0]),
      o: Number(k[1]),
      h: Number(k[2]),
      l: Number(k[3]),
      c: Number(k[4]),
    }));
  } catch {
    return [];
  }
}

export type DeltaSeries = {
  times: number[]; // центры корзин
  buy: number[];
  sell: number[];
  delta: number[]; // buy - sell за корзину
  cvd: number[]; // кумулятивная дельта
};

// Дельта/кумулятивная дельта из ленты сделок (ObTrade). Корзины времени
// совпадают по сетке с heatmap (cols). Берём binance-futures как референс.
export async function computeDelta(
  symbol: string,
  fromMs: number,
  toMs: number,
  cols = 240,
): Promise<DeltaSeries | null> {
  const rows = await prisma.obTrade.findMany({
    where: { symbol, exchange: "binance-futures", t: { gte: new Date(fromMs), lte: new Date(toMs) } },
    select: { t: true, buyVol: true, sellVol: true },
    orderBy: { t: "asc" },
  });
  if (rows.length === 0) return null;

  const xspan = toMs - fromMs || 1;
  const colOf = (t: number) => Math.max(0, Math.min(cols - 1, Math.floor(((t - fromMs) / xspan) * cols)));
  const buy = new Array(cols).fill(0);
  const sell = new Array(cols).fill(0);
  for (const r of rows) {
    const c = colOf(r.t.getTime());
    buy[c] += r.buyVol;
    sell[c] += r.sellVol;
  }
  const delta = buy.map((b, i) => b - sell[i]);
  const cvd: number[] = [];
  let run = 0;
  for (const d of delta) {
    run += d;
    cvd.push(run);
  }
  const times = new Array(cols).fill(0).map((_, c) => Math.round(fromMs + ((c + 0.5) / cols) * xspan));
  return { times, buy, sell, delta, cvd };
}

export async function computeOrderflow(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  opts: { bins?: number; cols?: number } = {},
): Promise<ObHeatmap | null> {
  const where = {
    symbol,
    t: { gte: new Date(fromMs), lte: new Date(toMs) },
    ...(exchange === "all" ? {} : { exchange }),
  };
  const rows = await prisma.obSnapshot.findMany({
    where,
    select: { t: true, price: true, bidVol: true, askVol: true, exchange: true },
    orderBy: { t: "asc" },
  });
  return buildOrderflowHeatmap(rows, fromMs, toMs, opts);
}
