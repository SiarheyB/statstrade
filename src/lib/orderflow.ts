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
  // Профиль текущего стакана (последний снапшот): объём bid/ask по бинам.
  profileBid: number[]; // длина bins
  profileAsk: number[];
  profileMax: number;
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

  // Текущая цена и профиль стакана — из последнего снапшота (окно ~5с, чтобы
  // в режиме «все биржи» захватить свежие данные каждой площадки).
  const lastT = Math.max(...rows.map((r) => r.t.getTime()));
  const lastRows = rows.filter((r) => r.t.getTime() >= lastT - 5000);
  const price = lastRows.length
    ? lastRows.reduce((s, r) => s + r.price, 0) / lastRows.length
    : rows[rows.length - 1].price;

  // Профиль текущей ликвидности: берём по самому свежему t каждой биржи, чтобы
  // не дублировать уровни из нескольких снапшотов.
  const latestPerEx = new Map<string, number>();
  for (const r of lastRows) {
    const ex = r.exchange ?? "_";
    const ts = r.t.getTime();
    if (ts > (latestPerEx.get(ex) ?? 0)) latestPerEx.set(ex, ts);
  }
  const profileBid = new Array(bins).fill(0);
  const profileAsk = new Array(bins).fill(0);
  for (const r of lastRows) {
    if (r.t.getTime() !== latestPerEx.get(r.exchange ?? "_")) continue;
    const b = binOf(r.price);
    profileBid[b] += r.bidVol;
    profileAsk[b] += r.askVol;
  }
  let profileMax = 0;
  for (let b = 0; b < bins; b++) {
    const v = profileBid[b] + profileAsk[b];
    if (v > profileMax) profileMax = v;
  }

  return {
    priceMin: pMin, priceMax: pMax, bins, cols, grid, maxVal, price, times,
    profileBid, profileAsk, profileMax,
  };
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
  exchange: string,
  range: string,
  fromMs: number,
  toMs: number,
): Promise<OfCandle[]> {
  const interval = CANDLE_INTERVAL[range] ?? "1m";
  // Spot — со спотового API, фьючерсы/агрегат — с фьючерсного.
  const url =
    exchange === "binance-spot"
      ? `https://api.binance.com/api/v3/klines?symbol=${symbol}` +
        `&interval=${interval}&startTime=${fromMs}&endTime=${toMs}&limit=1500`
      : `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}` +
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
  exchange: string,
  fromMs: number,
  toMs: number,
  cols = 240,
): Promise<DeltaSeries | null> {
  const rows = await prisma.obTrade.findMany({
    where: {
      symbol,
      ...(exchange === "all" ? {} : { exchange }),
      t: { gte: new Date(fromMs), lte: new Date(toMs) },
    },
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

export type FootprintLevel = { price: number; buy: number; sell: number };
export type FootprintCandle = { t: number; levels: FootprintLevel[] };
export type Footprint = { interval: number; maxVol: number; candles: FootprintCandle[] };

// Длительность свечи под диапазон (мс) — совпадает с CANDLE_INTERVAL.
const CANDLE_MS: Record<string, number> = {
  "15m": 60_000,
  "1h": 60_000,
  "4h": 300_000,
  "24h": 1_800_000,
};

// Footprint-кластеры: объём покупок/продаж по ценовым уровням внутри свечи.
// Источник — лента сделок Binance (ObFootprint), поэтому всегда binance-futures.
export async function computeFootprint(
  symbol: string,
  exchange: string,
  range: string,
  fromMs: number,
  toMs: number,
): Promise<Footprint | null> {
  const interval = CANDLE_MS[range] ?? 60_000;
  const rows = await prisma.obFootprint.findMany({
    where: {
      symbol,
      ...(exchange === "all" ? {} : { exchange }),
      t: { gte: new Date(fromMs), lte: new Date(toMs) },
    },
    select: { t: true, price: true, buyVol: true, sellVol: true },
    orderBy: { t: "asc" },
  });
  if (rows.length === 0) return null;

  // Группируем по свече (по времени открытия) и цене.
  const byCandle = new Map<number, Map<number, { buy: number; sell: number }>>();
  for (const r of rows) {
    const bucket = Math.floor(r.t.getTime() / interval) * interval;
    let lvls = byCandle.get(bucket);
    if (!lvls) { lvls = new Map(); byCandle.set(bucket, lvls); }
    const cell = lvls.get(r.price) ?? { buy: 0, sell: 0 };
    cell.buy += r.buyVol;
    cell.sell += r.sellVol;
    lvls.set(r.price, cell);
  }

  let maxVol = 0;
  const candles: FootprintCandle[] = [...byCandle.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, lvls]) => {
      const levels: FootprintLevel[] = [...lvls.entries()].map(([price, c]) => ({ price, buy: c.buy, sell: c.sell }));
      for (const l of levels) { const v = l.buy + l.sell; if (v > maxVol) maxVol = v; }
      return { t, levels };
    });

  return { interval, maxVol, candles };
}

export type BaSeries = {
  times: number[];
  full: number[]; // доля bid во всём ±depth: bid/(bid+ask), 0..1
  near: number[]; // то же в пределах ±1% от mid
};

// Дисбаланс bid/ask во времени (B/A панель). Для каждого снапшота оцениваем mid
// (между верхним bid-уровнем и нижним ask-уровнем) и считаем долю bid-объёма.
export async function computeBA(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  cols = 240,
): Promise<BaSeries | null> {
  const where = {
    symbol,
    t: { gte: new Date(fromMs), lte: new Date(toMs) },
    ...(exchange === "all" ? {} : { exchange }),
  };
  const rows = await prisma.obSnapshot.findMany({
    where,
    select: { t: true, exchange: true, price: true, bidVol: true, askVol: true },
    orderBy: { t: "asc" },
  });
  if (rows.length === 0) return null;

  // Группируем по снапшоту (exchange|t).
  const snaps = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.exchange}|${r.t.getTime()}`;
    const arr = snaps.get(k) ?? [];
    arr.push(r);
    snaps.set(k, arr);
  }

  const xspan = toMs - fromMs || 1;
  const colOf = (t: number) => Math.max(0, Math.min(cols - 1, Math.floor(((t - fromMs) / xspan) * cols)));
  const fullSum = new Array(cols).fill(0).map(() => ({ bid: 0, ask: 0, n: 0 }));
  const nearSum = new Array(cols).fill(0).map(() => ({ bid: 0, ask: 0 }));

  for (const [k, arr] of snaps) {
    const ts = Number(k.split("|")[1]);
    const c = colOf(ts);
    let maxBid = 0;
    let minAsk = Infinity;
    let bidAll = 0;
    let askAll = 0;
    for (const r of arr) {
      bidAll += r.bidVol;
      askAll += r.askVol;
      if (r.bidVol > 0 && r.price > maxBid) maxBid = r.price;
      if (r.askVol > 0 && r.price < minAsk) minAsk = r.price;
    }
    const mid = maxBid > 0 && minAsk < Infinity ? (maxBid + minAsk) / 2 : 0;
    fullSum[c].bid += bidAll;
    fullSum[c].ask += askAll;
    fullSum[c].n += 1;
    if (mid > 0) {
      const lo = mid * 0.99;
      const hi = mid * 1.01;
      for (const r of arr) {
        if (r.price < lo || r.price > hi) continue;
        nearSum[c].bid += r.bidVol;
        nearSum[c].ask += r.askVol;
      }
    }
  }

  const ratio = (b: number, a: number) => (b + a > 0 ? b / (b + a) : 0.5);
  const full = fullSum.map((s) => ratio(s.bid, s.ask));
  const near = nearSum.map((s) => ratio(s.bid, s.ask));
  const times = new Array(cols).fill(0).map((_, c) => Math.round(fromMs + ((c + 0.5) / cols) * xspan));
  return { times, full, near };
}

export type BigTrade = { t: number; price: number; qty: number; side: string; exchange: string };

// Последние крупные рыночные сделки (лента). Источник — Binance trade stream.
export async function computeBigTrades(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  limit = 60,
): Promise<BigTrade[]> {
  const rows = await prisma.obBigTrade.findMany({
    where: {
      symbol,
      ...(exchange === "all" ? {} : { exchange }),
      t: { gte: new Date(fromMs), lte: new Date(toMs) },
    },
    select: { t: true, price: true, qty: true, side: true, exchange: true },
    orderBy: { t: "desc" },
    take: limit,
  });
  return rows.map((r) => ({ t: r.t.getTime(), price: r.price, qty: r.qty, side: r.side, exchange: r.exchange }));
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
