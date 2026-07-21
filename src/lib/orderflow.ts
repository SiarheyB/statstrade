// Orderbook heatmap — построение грида из снапшотов, собранных collector-сервисом
// (таблица ObSnapshot). В отличие от liqmap (синтетика из свечей), здесь реальные
// исторические данные стакана: X — время, Y — цена, интенсивность — объём лимиток
// (bid+ask) на ценовом уровне. «Стены» крупных игроков светятся и гаснут.

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

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

export type OfCandle = { t: number; o: number; h: number; l: number; c: number };

// Интервал свечей = выбранный таймфрейм (Binance klines interval).
const CANDLE_INTERVAL: Record<string, string> = {
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "12h": "12h",
  "1d": "1d",
  "1w": "1w",
};

// Свечи для наложения поверх heatmap. Читаются из БД (таблица ObCandle),
// заполняется collector-сервисом. Никаких on-demand запросов к Binance —
// синхронизацией свечей занимается collector.
// Если в БД ещё нет данных (collector не успел) — возвращаем пустой массив;
// live-обновление (3с) подтянет их при следующем опросе.
export async function fetchOrderflowCandles(
  symbol: string,
  exchange: string,
  range: string,
  fromMs: number,
  toMs: number,
): Promise<OfCandle[]> {
  const interval = CANDLE_INTERVAL[range] ?? "1m";

  try {
    const rows = await prisma.obCandle.findMany({
      where: {
        symbol,
        exchange,
        interval,
        t: { gte: new Date(fromMs), lte: new Date(toMs) },
      },
      orderBy: { t: "asc" },
      select: { t: true, o: true, h: true, l: true, c: true },
    });

    return rows.map((r) => ({
      t: r.t.getTime(),
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
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
// совпадают по сетке с heatmap (cols). Агрегация прямо в Postgres: раньше сюда
// переносились все сырые строки за окно (сотни тысяч при широком таймфрейме),
// хотя дальше они просто суммировались по корзинам.
export async function computeDelta(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  cols = 240,
): Promise<DeltaSeries | null> {
  const xspan = toMs - fromMs || 1;
  const exFilter = exchange === "all" ? Prisma.empty : Prisma.sql`AND "exchange" = ${exchange}`;
  const colExpr = Prisma.sql`floor((extract(epoch from "t") * 1000 - ${fromMs}) / ${xspan} * ${cols})`;
  const rows = await prisma.$queryRaw<{ col: number; buy: number; sell: number }[]>`
    SELECT ${colExpr}::int AS col,
           SUM("buyVol")::float8 AS buy,
           SUM("sellVol")::float8 AS sell
    FROM "ObTrade"
    WHERE "symbol" = ${symbol} AND "t" >= ${new Date(fromMs)} AND "t" <= ${new Date(toMs)} ${exFilter}
    GROUP BY col
  `;
  if (rows.length === 0) return null;

  const clampCol = (c: number) => Math.max(0, Math.min(cols - 1, c));
  const buy = new Array(cols).fill(0);
  const sell = new Array(cols).fill(0);
  for (const r of rows) {
    const c = clampCol(r.col);
    buy[c] += r.buy;
    sell[c] += r.sell;
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

// Длительность свечи (мс) = выбранный таймфрейм — совпадает с CANDLE_INTERVAL.
const CANDLE_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
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
  // Группировка по свече (время открытия) и цене — в Postgres, вместо переноса
  // всех сырых строк за окно в Node (уровни × снапшоты — быстро растёт).
  const exFilter = exchange === "all" ? Prisma.empty : Prisma.sql`AND "exchange" = ${exchange}`;
  const rows = await prisma.$queryRaw<
    { bucket: bigint; price: number; buy: number; sell: number }[]
  >`
    SELECT (floor(extract(epoch from "t") * 1000 / ${interval}) * ${interval})::int8 AS bucket,
           "price" AS price,
           SUM("buyVol")::float8 AS buy,
           SUM("sellVol")::float8 AS sell
    FROM "ObFootprint"
    WHERE "symbol" = ${symbol} AND "t" >= ${new Date(fromMs)} AND "t" <= ${new Date(toMs)} ${exFilter}
    GROUP BY bucket, "price"
    ORDER BY bucket
  `;
  if (rows.length === 0) return null;

  let maxVol = 0;
  const byCandle = new Map<number, FootprintLevel[]>();
  for (const r of rows) {
    if (r.buy === 0 && r.sell === 0) continue;
    const t = Number(r.bucket);
    let levels = byCandle.get(t);
    if (!levels) { levels = []; byCandle.set(t, levels); }
    levels.push({ price: r.price, buy: r.buy, sell: r.sell });
    const v = r.buy + r.sell;
    if (v > maxVol) maxVol = v;
  }
  const candles: FootprintCandle[] = [...byCandle.entries()].map(([t, levels]) => ({ t, levels }));

  return { interval, maxVol, candles };
}

export type BaSeries = {
  times: number[];
  full: number[]; // доля bid во всём ±depth: bid/(bid+ask), 0..1
  near: number[]; // то же в пределах ±1% от mid
};

// Дисбаланс bid/ask во времени (B/A панель). Для каждого снапшота оцениваем mid
// (между верхним bid-уровнем и нижним ask-уровнем) и считаем долю bid-объёма.
//
// Быстрый путь — из rollup-таблиц (join двух маленьких агрегатов вместо self-join
// по миллионам сырых снапшотов). Если rollup ещё пуст (свежий деплой), падаем на
// сырой путь computeBARaw.
export async function computeBA(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  cols = 240,
): Promise<BaSeries | null> {
  const xspan = toMs - fromMs || 1;
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const exR = exchange === "all" ? Prisma.empty : Prisma.sql`AND r."exchange" = ${exchange}`;
  const colExpr = Prisma.sql`floor((extract(epoch from r."bucket") * 1000 - ${fromMs}) / ${xspan} * ${cols})`;
  const nearLo = Prisma.sql`(b."midSum" / b."snaps") * 0.99`;
  const nearHi = Prisma.sql`(b."midSum" / b."snaps") * 1.01`;

  const rows = await prisma.$queryRaw<
    { col: number; full_bid: number; full_ask: number; near_bid: number; near_ask: number }[]
  >`
    SELECT ${colExpr}::int AS col,
           SUM(r."bidSum")::float8 AS full_bid,
           SUM(r."askSum")::float8 AS full_ask,
           COALESCE(SUM(r."bidSum") FILTER (WHERE b."snaps" > 0 AND r."price" BETWEEN ${nearLo} AND ${nearHi}), 0)::float8 AS near_bid,
           COALESCE(SUM(r."askSum") FILTER (WHERE b."snaps" > 0 AND r."price" BETWEEN ${nearLo} AND ${nearHi}), 0)::float8 AS near_ask
    FROM "ObSnapshotRollup" r
    JOIN "ObRollupBucket" b
      ON b."symbol" = r."symbol" AND b."exchange" = r."exchange" AND b."bucket" = r."bucket"
    WHERE r."symbol" = ${symbol} AND r."bucket" >= ${from} AND r."bucket" <= ${to} ${exR}
    GROUP BY col
  `;
  if (rows.length === 0) return computeBARaw(symbol, exchange, fromMs, toMs, cols);

  const clampCol = (c: number) => Math.max(0, Math.min(cols - 1, c));
  const fullBid = new Array(cols).fill(0);
  const fullAsk = new Array(cols).fill(0);
  const nearBid = new Array(cols).fill(0);
  const nearAsk = new Array(cols).fill(0);
  for (const r of rows) {
    const c = clampCol(r.col);
    fullBid[c] += r.full_bid;
    fullAsk[c] += r.full_ask;
    nearBid[c] += r.near_bid;
    nearAsk[c] += r.near_ask;
  }
  const ratio = (b: number, a: number) => (b + a > 0 ? b / (b + a) : 0.5);
  const full = fullBid.map((b, i) => ratio(b, fullAsk[i]));
  const near = nearBid.map((b, i) => ratio(b, nearAsk[i]));
  const times = new Array(cols).fill(0).map((_, c) => Math.round(fromMs + ((c + 0.5) / cols) * xspan));
  return { times, full, near };
}

// Сырой fallback B/A (по ObSnapshot) — используется, пока rollup не наполнен.
async function computeBARaw(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  cols = 240,
): Promise<BaSeries | null> {
  // Всё считаем в Postgres (CTE), чтобы не тянуть сырые строки снапшотов:
  //  snap — агрегаты по снапшоту (exchange,t): суммы bid/ask и границы стакана;
  //  m    — mid между верхним bid и нижним ask;
  //  nr   — bid/ask в пределах ±1% от mid (пере-join к снапшоту по exchange,t);
  //  финал — суммы по колонкам времени.
  const xspan = toMs - fromMs || 1;
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const exFilter = exchange === "all" ? Prisma.empty : Prisma.sql`AND "exchange" = ${exchange}`;
  const colExpr = Prisma.sql`floor((extract(epoch from m.t) * 1000 - ${fromMs}) / ${xspan} * ${cols})`;

  const rows = await prisma.$queryRaw<
    { col: number; full_bid: number; full_ask: number; near_bid: number; near_ask: number }[]
  >`
    WITH snap AS (
      SELECT "exchange" AS ex, "t" AS t,
             SUM("bidVol") AS bid_all,
             SUM("askVol") AS ask_all,
             MAX("price") FILTER (WHERE "bidVol" > 0) AS max_bid,
             MIN("price") FILTER (WHERE "askVol" > 0) AS min_ask
      FROM "ObSnapshot"
      WHERE "symbol" = ${symbol} AND "t" >= ${from} AND "t" <= ${to} ${exFilter}
      GROUP BY "exchange", "t"
    ),
    m AS (
      SELECT ex, t, bid_all, ask_all,
             CASE WHEN max_bid IS NOT NULL AND min_ask IS NOT NULL
                  THEN (max_bid + min_ask) / 2 ELSE NULL END AS mid
      FROM snap
    ),
    nr AS (
      SELECT m.ex AS ex, m.t AS t,
             SUM(o."bidVol") AS near_bid,
             SUM(o."askVol") AS near_ask
      FROM m
      JOIN "ObSnapshot" o
        ON o."symbol" = ${symbol} AND o."exchange" = m.ex AND o."t" = m.t
       AND o."price" BETWEEN m.mid * 0.99 AND m.mid * 1.01
      WHERE m.mid IS NOT NULL
      GROUP BY m.ex, m.t
    )
    SELECT ${colExpr}::int AS col,
           SUM(m.bid_all)::float8 AS full_bid,
           SUM(m.ask_all)::float8 AS full_ask,
           COALESCE(SUM(nr.near_bid), 0)::float8 AS near_bid,
           COALESCE(SUM(nr.near_ask), 0)::float8 AS near_ask
    FROM m LEFT JOIN nr ON nr.ex = m.ex AND nr.t = m.t
    GROUP BY col
  `;
  if (rows.length === 0) return null;

  const clampCol = (c: number) => Math.max(0, Math.min(cols - 1, c));
  const fullBid = new Array(cols).fill(0);
  const fullAsk = new Array(cols).fill(0);
  const nearBid = new Array(cols).fill(0);
  const nearAsk = new Array(cols).fill(0);
  for (const r of rows) {
    const c = clampCol(r.col);
    fullBid[c] += r.full_bid;
    fullAsk[c] += r.full_ask;
    nearBid[c] += r.near_bid;
    nearAsk[c] += r.near_ask;
  }
  const ratio = (b: number, a: number) => (b + a > 0 ? b / (b + a) : 0.5);
  const full = fullBid.map((b, i) => ratio(b, fullAsk[i]));
  const near = nearBid.map((b, i) => ratio(b, nearAsk[i]));
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
  // Агрегация прямо в Postgres: вместо переноса миллионов сырых строк снапшотов
  // в Node, БД сама сворачивает их в сетку (колонка времени × ценовой уровень).
  // Это снимает основную нагрузку (перенос данных рос со временем накопления).
  const bins = opts.bins ?? 110; // меньше бинов → полосы лимиток выше и заметнее
  const cols = opts.cols ?? 240;
  const xspan = toMs - fromMs || 1;
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const exFilter = exchange === "all" ? Prisma.empty : Prisma.sql`AND "exchange" = ${exchange}`;
  const colExpr = Prisma.sql`floor((extract(epoch from "t") * 1000 - ${fromMs}) / ${xspan} * ${cols})`;

  // Быстрый путь — из rollup (минутные бакеты): сумма ликвидности по (колонка,
  // уровень) + число снапшотов/бирж на колонку. Если rollup ещё пуст (свежий
  // деплой), считаем по сырой таблице ObSnapshot (legacy-путь ниже).
  const colExprR = Prisma.sql`floor((extract(epoch from "bucket") * 1000 - ${fromMs}) / ${xspan} * ${cols})`;
  let cells = await prisma.$queryRaw<{ col: number; price: number; vol: number }[]>`
    SELECT ${colExprR}::int AS col, "price" AS price, SUM("volSum")::float8 AS vol
    FROM "ObSnapshotRollup"
    WHERE "symbol" = ${symbol} AND "bucket" >= ${from} AND "bucket" <= ${to} ${exFilter}
    GROUP BY col, "price"
  `;
  let colStats: { col: number; n: number; ex: number }[];
  if (cells.length > 0) {
    colStats = await prisma.$queryRaw<{ col: number; n: number; ex: number }[]>`
      SELECT ${colExprR}::int AS col, SUM("snaps")::int AS n, COUNT(DISTINCT "exchange")::int AS ex
      FROM "ObRollupBucket"
      WHERE "symbol" = ${symbol} AND "bucket" >= ${from} AND "bucket" <= ${to} ${exFilter}
      GROUP BY col
    `;
  } else {
    // Legacy fallback: сырые снапшоты.
    cells = await prisma.$queryRaw<{ col: number; price: number; vol: number }[]>`
      SELECT ${colExpr}::int AS col, "price" AS price, SUM("bidVol" + "askVol")::float8 AS vol
      FROM "ObSnapshot"
      WHERE "symbol" = ${symbol} AND "t" >= ${from} AND "t" <= ${to} ${exFilter}
      GROUP BY col, "price"
    `;
    if (cells.length === 0) return null;
    colStats = await prisma.$queryRaw<{ col: number; n: number; ex: number }[]>`
      SELECT ${colExpr}::int AS col,
             COUNT(DISTINCT ("exchange" || '|' || extract(epoch from "t")))::int AS n,
             COUNT(DISTINCT "exchange")::int AS ex
      FROM "ObSnapshot"
      WHERE "symbol" = ${symbol} AND "t" >= ${from} AND "t" <= ${to} ${exFilter}
      GROUP BY col
    `;
  }
  const kByCol = new Map<number, number>();
  for (const s of colStats) kByCol.set(s.col, (s.ex || 1) / (s.n || 1));

  let pMin = Infinity;
  let pMax = -Infinity;
  for (const c of cells) {
    if (c.price < pMin) pMin = c.price;
    if (c.price > pMax) pMax = c.price;
  }
  const pad = (pMax - pMin) * 0.02 || pMax * 0.005;
  pMin -= pad;
  pMax += pad;
  const span = pMax - pMin || 1;
  const binOf = (p: number) => Math.max(0, Math.min(bins - 1, Math.floor(((p - pMin) / span) * bins)));
  const clampCol = (c: number) => Math.max(0, Math.min(cols - 1, c));

  const grid: number[][] = Array.from({ length: cols }, () => new Array(bins).fill(0));
  for (const cell of cells) {
    grid[clampCol(cell.col)][binOf(cell.price)] += cell.vol * (kByCol.get(cell.col) ?? 0);
  }
  let maxVal = 0;
  for (const col of grid) for (const v of col) if (v > maxVal) maxVal = v;
  const times = new Array(cols).fill(0).map((_, c) => Math.round(fromMs + ((c + 0.5) / cols) * xspan));

  // Профиль текущего стакана: самый свежий снапшот каждой биржи (окно ~5с).
  const lastRows = await prisma.$queryRaw<
    { t: Date; exchange: string; price: number; bidVol: number; askVol: number }[]
  >`
    SELECT "t", "exchange", "price", "bidVol", "askVol"
    FROM "ObSnapshot"
    WHERE "symbol" = ${symbol} AND "t" >= ${from} AND "t" <= ${to} ${exFilter}
      AND "t" >= (
        SELECT MAX("t") FROM "ObSnapshot"
        WHERE "symbol" = ${symbol} AND "t" >= ${from} AND "t" <= ${to} ${exFilter}
      ) - interval '5 seconds'
  `;
  const profileBid = new Array(bins).fill(0);
  const profileAsk = new Array(bins).fill(0);
  let price: number;
  if (lastRows.length) {
    price = lastRows.reduce((s, r) => s + r.price, 0) / lastRows.length;
    const latestPerEx = new Map<string, number>();
    for (const r of lastRows) {
      const ts = r.t.getTime();
      if (ts > (latestPerEx.get(r.exchange) ?? 0)) latestPerEx.set(r.exchange, ts);
    }
    for (const r of lastRows) {
      if (r.t.getTime() !== latestPerEx.get(r.exchange)) continue;
      const b = binOf(r.price);
      profileBid[b] += r.bidVol;
      profileAsk[b] += r.askVol;
    }
  } else {
    price = (pMin + pMax) / 2;
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
