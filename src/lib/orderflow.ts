// Orderbook heatmap — построение грида из снапшотов, собранных collector-сервисом
// (таблица ObSnapshot). В отличие от liqmap (синтетика из свечей), здесь реальные
// исторические данные стакана: X — время, Y — цена, интенсивность — объём лимиток
// (bid+ask) на ценовом уровне. «Стены» крупных игроков светятся и гаснут.

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

// Сколько свечей вставлять за один batch (чтобы не перегружать Prisma/$executeRaw).
const CANDLE_INSERT_BATCH = 100;

// Таймауты на запросы к бирже. Без них запрос висел до proxy_read_timeout
// nginx (75 с), занимая соединение и слот пула Prisma, — а это самый частый
// внешний вызов в приложении: он идёт на КАЖДЫЙ опрос свечей открытой
// вкладкой. Из одиннадцати внешних fetch в src/ таймаут стоял у девяти;
// не было именно у этих двух.
const LIVE_CANDLE_TIMEOUT_MS = 4000;   // добор формирующейся свечи (2 бара)
const HISTORY_FETCH_TIMEOUT_MS = 12_000; // добор истории (до 1500 баров)

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

// Сколько свечей таймфрейма ТЯНЕМ в окно. Держим глубокую историю (как в
// ClusterBtc): фронт по умолчанию показывает недавние ~100 свечей, а влево
// прокручивается вся история. Коллектор теперь хранит историю полностью (чистка
// вручную из админки) и пишет только крупные стены, поэтому широкое окно дёшево.
// Ограничено лимитом Binance klines (1500 баров за запрос).
export const CANDLES_IN_WINDOW: Record<string, number> = {
  "5m": 400,
  "15m": 400,
  "1h": 800,
  "4h": 800,
  "12h": 800,
  "1d": 365,
  "1w": 200,
};
export const DEFAULT_CANDLES = 300;

// Длительность одной свечи таймфрейма. Ширина окна = TF_MS × CANDLES_IN_WINDOW.
export const TF_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

/**
 * Границы окна карты ордеров.
 *
 * `toMs` передаётся явно, когда окно уже посчитано другим запросом: свечи и
 * наложения теперь грузятся ДВУМЯ запросами (сначала свечи — график виден
 * сразу, потом heatmap поверх него), и если каждый возьмёт свой `Date.now()`,
 * их сетки времени разъедутся на длину первого запроса — карта сместится
 * относительно свечей.
 */
export function orderflowWindow(
  range: string,
  toMs: number = Date.now(),
): { from: number; to: number; tf: number } | null {
  const tf = TF_MS[range];
  if (!tf) return null;
  return { from: toMs - tf * (CANDLES_IN_WINDOW[range] ?? DEFAULT_CANDLES), to: toMs, tf };
}

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
// opts.live — нужна ли СВЕЖАЯ формирующаяся свеча.
//
// Ради неё функция ходит в Binance на каждый вызов, и это 366 из ~400 мс
// (измерено). Графику это нужно: он опрашивает /api/orderflow раз в 3 с и
// показывает текущую свечу в реальном времени. А детекторам дивергенций и
// абсорбции — нет: они анализируют ЗАКРЫТЫЕ свечи, и живая последняя им
// ничего не даёт. Раньше они платили за неё те же 366 мс на каждый опрос.
export async function fetchOrderflowCandles(
  symbol: string,
  exchange: string,
  range: string,
  fromMs: number,
  toMs: number,
  opts: { live?: boolean } = {},
): Promise<OfCandle[]> {
  const live = opts.live !== false;
  const interval = CANDLE_INTERVAL[range] ?? "1m";

  // URL для запросов к Binance (используется и при fallback, и при live-обновлении)
  const urlBase = exchange === "binance-futures"
    ? "https://fapi.binance.com/fapi/v1/klines"
    : exchange === "binance-spot"
      ? "https://api.binance.com/api/v3/klines"
      : null;

  // Try to get existing candles from the local DB (ObCandle table)
  // Prisma returns t as Date, so we use a separate type and convert to OfCandle.
  interface ObCandleRow { t: Date; o: number; h: number; l: number; c: number; }
  let rows: ObCandleRow[] = [];
  try {
    rows = await prisma.obCandle.findMany({
      where: {
        symbol,
        exchange,
        interval,
        t: { gte: new Date(fromMs), lte: new Date(toMs) },
      },
      orderBy: { t: "asc" },
      select: { t: true, o: true, h: true, l: true, c: true },
    });
  } catch {
    // If we can't query the DB (e.g., missing table on a fresh deploy) we fall back to
    // direct Binance fetch – this mimics the pre‑collector behavior where candles were
    // obtained on‑demand from Binance klines.
  }

  // If we have enough candles to satisfy the UI's expected window, return them.
  // Otherwise (e.g., after a fresh deploy or when data is sparse) fall back to a
  // direct Binance request to fill the gaps.
  const expected = CANDLES_IN_WINDOW[range] ?? 300;
  if (rows.length >= expected) {
    const result = rows.map(r => ({
      t: r.t.getTime(),
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
    }));

    // ═══════════════════════════════════════════════════════════════════
    // В LIVE-режиме формирующаяся свеча должна обновляться в реальном
    // времени. Даже если в БД достаточно свечей, дозапрашиваем последние
    // 2 свечи с Binance, чтобы обновить h/l/c/v текущей свечи.
    // Это лёгкий запрос (2 свечи) — не перегружает ни Binance, ни БД.
    // ═══════════════════════════════════════════════════════════════════
    if (live && result.length > 0 && urlBase) {
      try {
        const latestUrl = `${urlBase}?symbol=${symbol}&interval=${interval}&limit=2`;
        const latestRes = await fetch(latestUrl, {
          signal: AbortSignal.timeout(LIVE_CANDLE_TIMEOUT_MS),
        });
        if (latestRes.ok) {
          const latestRaw = await latestRes.json() as (string | number)[][];
          if (latestRaw.length > 0) {
            // Сохраняем последние свечи в БД
            for (let i = 0; i < latestRaw.length; i += CANDLE_INSERT_BATCH) {
              const batch = latestRaw.slice(i, i + CANDLE_INSERT_BATCH);
              const batchRows = batch.map((k) => Prisma.sql`
                (${symbol}, ${exchange}, ${interval}, ${new Date(Number(k[0]))},
                 ${Number(k[1])}, ${Number(k[2])}, ${Number(k[3])}, ${Number(k[4])}, ${Number(k[5])})
              `);
              await prisma.$executeRaw(
                Prisma.sql`INSERT INTO "ObCandle" ("symbol","exchange","interval","t","o","h","l","c","v")
                           VALUES ${Prisma.join(batchRows)}
                           ON CONFLICT ("symbol","exchange","interval","t") DO UPDATE SET
                             "h" = EXCLUDED."h",
                             "l" = EXCLUDED."l",
                             "c" = EXCLUDED."c",
                             "v" = EXCLUDED."v"`,
              );
            }
            // Обновляем последнюю свечу в результате, если её timestamp совпадает
            const latestBinance = latestRaw[latestRaw.length - 1];
            const latestT = Number(latestBinance[0]);
            const lastIdx = result.length - 1;
            if (result[lastIdx].t === latestT) {
              result[lastIdx] = {
                t: latestT,
                o: Number(latestBinance[1]),
                h: Number(latestBinance[2]),
                l: Number(latestBinance[3]),
                c: Number(latestBinance[4]),
              };
            }
          }
        }
      } catch {
        // Тихая ошибка — свечи из БД уже есть, просто не смогли обновить
      }
    }

    return result;
  }

  // -----– Direct Binance fallback – mirrors the original implementation ----------
  if (urlBase) {
    const url = `${urlBase}?symbol=${symbol}&interval=${interval}`
      + `&startTime=${fromMs}&endTime=${toMs}&limit=1500`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(HISTORY_FETCH_TIMEOUT_MS) });
      if (res.ok) {
        const raw = await res.json() as (string | number)[][];
        // ═══════════════════════════════════════════════════════════════════
        // Сохраняем полученные с биржи свечи в БД, чтобы при следующих
        // запросах данные уже были в ObCandle и не приходилось снова лезть
        // на Binance. Коллектор тоже заполняет эту таблицу, но если он
        // перезапущен или не успел — API дозаполнит самостоятельно.
        // ═══════════════════════════════════════════════════════════════════
        try {
          for (let i = 0; i < raw.length; i += CANDLE_INSERT_BATCH) {
            const batch = raw.slice(i, i + CANDLE_INSERT_BATCH);
            const rows = batch.map((k) => Prisma.sql`
              (${symbol}, ${exchange}, ${interval}, ${new Date(Number(k[0]))},
               ${Number(k[1])}, ${Number(k[2])}, ${Number(k[3])}, ${Number(k[4])}, ${Number(k[5])})
            `);
            await prisma.$executeRaw(
              Prisma.sql`INSERT INTO "ObCandle" ("symbol","exchange","interval","t","o","h","l","c","v")
                         VALUES ${Prisma.join(rows)}
                         ON CONFLICT ("symbol","exchange","interval","t") DO UPDATE SET
                           "h" = EXCLUDED."h",
                           "l" = EXCLUDED."l",
                           "c" = EXCLUDED."c",
                           "v" = EXCLUDED."v"`,
            );
          }
        } catch (dbErr) {
          console.error(`[fetchOrderflowCandles] DB save error: ${(dbErr as Error).message}`);
        }
        // Convert Binance K‑line response to OfCandle shape.
        return raw.map((k) => ({
          t: Number(k[0]), // open time (ms)
          o: Number(k[1]), // open
          h: Number(k[2]), // high
          l: Number(k[3]), // low
          c: Number(k[4]), // close
        }));
      }
    } catch (e) {
      console.error(`[fetchOrderflowCandles] Binance fetch error: ${(e as Error).message}`);
    }
  }

  // If everything failed, return whatever we have from the DB even if less than expected.
  if (rows.length > 0) {
    return rows.map(r => ({
      t: r.t.getTime(),
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
    }));
  }
  return [];
}

// Длительность свечи по таймфрейму — нужна, чтобы посчитать окно добора с
// биржи. Держим рядом с CANDLE_INTERVAL, чтобы наборы не разъезжались.
const RANGE_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

function klinesUrlBase(exchange: string): string | null {
  return exchange === "binance-futures"
    ? "https://fapi.binance.com/fapi/v1/klines"
    : exchange === "binance-spot"
      ? "https://api.binance.com/api/v3/klines"
      : null;
}

// Догрузка истории свечей "влево" (пагинация по курсору `before`) при
// скролле/зуме графика. Возвращает свечи строго раньше `beforeMs`, по
// возрастанию времени, плюс признак "дальше есть ещё".
//
// Раньше функция читала СТРОГО из ObCandle, сознательно не ходя в Binance
// ("история не может появиться задним числом"). На практике это упиралось в
// то, что в ObCandle истории просто нет: таблицу наполняет fetchOrderflowCandles
// ровно на ширину окна (CANDLES_IN_WINDOW × ТФ), а старее туда никто не
// пишет. На 5m это 400 свечей ≈ 33 часа — скролл влево сразу отвечал
// "свечей 0, hasMore=false", график упирался в «начало истории», и вместе со
// свечами обрывались карта лимиток и кластеры, хотя в ObSnapshotRollup лежали
// ещё сутки данных. Поэтому: если БД не отдала полную страницу — добираем с
// биржи и сохраняем в ObCandle, чтобы следующий скролл шёл уже из БД.
export async function fetchOrderflowCandlesBefore(
  symbol: string,
  exchange: string,
  range: string,
  beforeMs: number,
  limit: number,
): Promise<{ candles: OfCandle[]; hasMore: boolean }> {
  const interval = CANDLE_INTERVAL[range] ?? "1m";
  interface ObCandleRow { t: Date; o: number; h: number; l: number; c: number; }
  let rows: ObCandleRow[] = [];
  try {
    rows = await prisma.obCandle.findMany({
      where: { symbol, exchange, interval, t: { lt: new Date(beforeMs) } },
      orderBy: { t: "desc" },
      take: limit,
      select: { t: true, o: true, h: true, l: true, c: true },
    });
  } catch {
    rows = [];
  }

  const byTime = new Map<number, OfCandle>();
  for (const r of rows) {
    byTime.set(r.t.getTime(), { t: r.t.getTime(), o: r.o, h: r.h, l: r.l, c: r.c });
  }

  // Полная страница из БД — добор не нужен.
  if (rows.length >= limit) {
    const candles = [...byTime.values()].sort((a, b) => a.t - b.t);
    return { candles, hasMore: true };
  }

  const urlBase = klinesUrlBase(exchange);
  const tfMs = RANGE_MS[range];
  if (urlBase && tfMs) {
    const endTime = beforeMs - 1;
    const startTime = beforeMs - limit * tfMs;
    try {
      const url = `${urlBase}?symbol=${symbol}&interval=${interval}`
        + `&startTime=${startTime}&endTime=${endTime}&limit=${Math.min(1500, limit)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(HISTORY_FETCH_TIMEOUT_MS) });
      if (res.ok) {
        const raw = (await res.json()) as (string | number)[][];
        for (const k of raw) {
          const t = Number(k[0]);
          if (t >= beforeMs) continue; // строго раньше курсора
          byTime.set(t, { t, o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]) });
        }
        // Сохраняем, чтобы следующий скролл в этот же диапазон шёл из БД.
        try {
          for (let i = 0; i < raw.length; i += CANDLE_INSERT_BATCH) {
            const batch = raw.slice(i, i + CANDLE_INSERT_BATCH);
            const values = batch.map((k) => Prisma.sql`
              (${symbol}, ${exchange}, ${interval}, ${new Date(Number(k[0]))},
               ${Number(k[1])}, ${Number(k[2])}, ${Number(k[3])}, ${Number(k[4])}, ${Number(k[5])})
            `);
            if (!values.length) continue;
            await prisma.$executeRaw(
              Prisma.sql`INSERT INTO "ObCandle" ("symbol","exchange","interval","t","o","h","l","c","v")
                         VALUES ${Prisma.join(values)}
                         ON CONFLICT ("symbol","exchange","interval","t") DO UPDATE SET
                           "h" = EXCLUDED."h",
                           "l" = EXCLUDED."l",
                           "c" = EXCLUDED."c",
                           "v" = EXCLUDED."v"`,
            );
          }
        } catch (dbErr) {
          console.error(`[fetchOrderflowCandlesBefore] DB save error: ${(dbErr as Error).message}`);
        }
      }
    } catch (e) {
      console.error(`[fetchOrderflowCandlesBefore] Binance fetch error: ${(e as Error).message}`);
    }
  }

  const candles = [...byTime.values()].sort((a, b) => a.t - b.t);
  // hasMore=true — набрали полную страницу, дальше почти наверняка ещё есть.
  return { candles, hasMore: candles.length >= limit };
}

export type DeltaSeries = {
  times: number[]; // центры корзин
  buy: number[];
  sell: number[];
  delta: number[]; // buy - sell за корзину
  cvd: number[]; // кумулятивная дельта
};

// Дельта/кумулятивная дельта из ленты сделок. Корзины времени совпадают по
// сетке с heatmap (cols).
//
// Быстрый путь — минутный rollup (ObTradeRollup): одна строка на
// symbol×exchange×минуту вместо сырых тиков. Ширина колонки здесь всегда
// заметно больше минуты (самое узкое окно — 400 пятиминуток ≈ 8 мин на
// колонку), так что минутная гранулярность ничего не огрубляет. Если rollup
// ещё пуст (свежий деплой до бэкафилла) — падаем на сырой ObTrade.
export async function computeDelta(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  cols = 240,
): Promise<DeltaSeries | null> {
  const xspan = toMs - fromMs || 1;
  const exFilter = exchange === "all" ? Prisma.empty : Prisma.sql`AND "exchange" = ${exchange}`;
  const colExprR = Prisma.sql`floor((extract(epoch from "bucket") * 1000 - ${fromMs}) / ${xspan} * ${cols})`;
  let rows = await prisma.$queryRaw<{ col: number; buy: number; sell: number }[]>`
    SELECT ${colExprR}::int AS col,
           SUM("buyVol")::float8 AS buy,
           SUM("sellVol")::float8 AS sell
    FROM "ObTradeRollup"
    WHERE "symbol" = ${symbol} AND "bucket" >= ${new Date(fromMs)} AND "bucket" <= ${new Date(toMs)} ${exFilter}
    GROUP BY col
  `;
  if (rows.length === 0) {
    const colExpr = Prisma.sql`floor((extract(epoch from "t") * 1000 - ${fromMs}) / ${xspan} * ${cols})`;
    rows = await prisma.$queryRaw<{ col: number; buy: number; sell: number }[]>`
      SELECT ${colExpr}::int AS col,
             SUM("buyVol")::float8 AS buy,
             SUM("sellVol")::float8 AS sell
      FROM "ObTrade"
      WHERE "symbol" = ${symbol} AND "t" >= ${new Date(fromMs)} AND "t" <= ${new Date(toMs)} ${exFilter}
      GROUP BY col
    `;
  }
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
//
// Быстрый путь — ObFootprintRollup (5-минутные бакеты × уровень). Пять минут это
// младший таймфрейм графика, а остальные кратны ему, поэтому свеча любого ТФ
// собирается из целых бакетов точно. Сырьё пишется на каждый тик коллектора на
// каждый уровень, и сворачивать его заново на каждый опрос (раз в 3 с) — самая
// дорогая часть orderflow. Fallback на сырьё, пока rollup не наполнен.
export async function computeFootprint(
  symbol: string,
  exchange: string,
  range: string,
  fromMs: number,
  toMs: number,
): Promise<Footprint | null> {
  const interval = CANDLE_MS[range] ?? 60_000;
  const exFilter = exchange === "all" ? Prisma.empty : Prisma.sql`AND "exchange" = ${exchange}`;
  // Уровень каскада футпринта — по длительности свечи: бакет не должен быть
  // крупнее её, иначе кластеры одной свечи размажутся по соседним. От часа и
  // выше свеча собирается из целых часовых бакетов (на дневной ТФ — ровно 24
  // строки вместо 288 пятиминутных).
  const fpTable = interval >= 3600_000 ? "ObFootprintRollupH" : "ObFootprintRollup";
  // ВАЖНО: алиас НЕ должен называться "bucket". В Postgres GROUP BY сначала
  // ищет колонку входной таблицы и только потом алиас SELECT, а в
  // ObFootprintRollup колонка "bucket" есть — группировка молча шла по сырому
  // 5-минутному бакету, уровни не схлопывались в свечу таймфрейма, и maxVol
  // (яркость кластеров) считался по 5-минуткам вместо свечи.
  let rows = await prisma.$queryRaw<
    { candle: bigint; price: number; buy: number; sell: number }[]
  >`
    SELECT (floor(extract(epoch from "bucket") * 1000 / ${interval}) * ${interval})::int8 AS candle,
           "price" AS price,
           SUM("buyVol")::float8 AS buy,
           SUM("sellVol")::float8 AS sell
    FROM ${Prisma.raw(`"${fpTable}"`)}
    WHERE "symbol" = ${symbol} AND "bucket" >= ${new Date(fromMs)} AND "bucket" <= ${new Date(toMs)} ${exFilter}
    GROUP BY candle, "price"
    ORDER BY candle
  `;
  // Часовой уровень мог ещё не наполниться (каскад догоняет историю после
  // деплоя) — тогда читаем пятиминутный, он полон всегда.
  if (rows.length === 0 && fpTable !== "ObFootprintRollup") {
    rows = await prisma.$queryRaw<
      { candle: bigint; price: number; buy: number; sell: number }[]
    >`
      SELECT (floor(extract(epoch from "bucket") * 1000 / ${interval}) * ${interval})::int8 AS candle,
             "price" AS price,
             SUM("buyVol")::float8 AS buy,
             SUM("sellVol")::float8 AS sell
      FROM "ObFootprintRollup"
      WHERE "symbol" = ${symbol} AND "bucket" >= ${new Date(fromMs)} AND "bucket" <= ${new Date(toMs)} ${exFilter}
      GROUP BY candle, "price"
      ORDER BY candle
    `;
  }
  if (rows.length === 0) {
    // Группировка по свече и цене — в Postgres, вместо переноса всех сырых строк
    // за окно в Node (уровни × снапшоты — быстро растёт).
    rows = await prisma.$queryRaw<
      { candle: bigint; price: number; buy: number; sell: number }[]
    >`
      SELECT (floor(extract(epoch from "t") * 1000 / ${interval}) * ${interval})::int8 AS candle,
             "price" AS price,
             SUM("buyVol")::float8 AS buy,
             SUM("sellVol")::float8 AS sell
      FROM "ObFootprint"
      WHERE "symbol" = ${symbol} AND "t" >= ${new Date(fromMs)} AND "t" <= ${new Date(toMs)} ${exFilter}
      GROUP BY candle, "price"
      ORDER BY candle
    `;
  }
  if (rows.length === 0) return null;

  let maxVol = 0;
  const byCandle = new Map<number, FootprintLevel[]>();
  for (const r of rows) {
    if (r.buy === 0 && r.sell === 0) continue;
    const t = Number(r.candle);
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

/**
 * Какой уровень каскада читать для окна такой ширины.
 *
 * Решает не таймфрейм, а ШИРИНА КОЛОНКИ (окно / число колонок): агрегат нельзя
 * брать грубее колонки, в которую он схлопывается, — иначе картинка поедет; а
 * брать мельче бессмысленно, это лишние сотни тысяч строк ради того же числа.
 *
 * Для нынешних таймфреймов раскладка выходит такая: 5m/15m — минутный уровень,
 * 1h/4h — часовой, 12h/1d/1w — дневной.
 */
export type RollupLevel = "minute" | "hour" | "day";

export function rollupLevelFor(fromMs: number, toMs: number, cols: number): RollupLevel {
  const colMs = (toMs - fromMs) / Math.max(1, cols);
  if (colMs >= 24 * 3600_000) return "day";
  if (colMs >= 3600_000) return "hour";
  return "minute";
}

// Таблицы уровня: цены и парные им счётчики снапшотов.
const ROLLUP_TABLES: Record<RollupLevel, { prices: string; snaps: string }> = {
  minute: { prices: "ObSnapshotRollup", snaps: "ObRollupBucket" },
  hour: { prices: "ObSnapshotRollupH", snaps: "ObRollupBucketH" },
  day: { prices: "ObSnapshotRollupD", snaps: "ObRollupBucketD" },
};

// Порядок попыток, если выбранный уровень пуст. Пустым он бывает по двум
// противоположным причинам, поэтому в списке есть уровни и мельче, и крупнее:
//
//  * каскад ещё не догнал историю (первые прогоны после деплоя) — тогда данные
//    лежат только на мелком уровне;
//  * минутный слой обрезан по ретеншну (он нужен лишь для окон шириной в
//    несколько дней, см. ROLLUP_MINUTE_RETENTION_DAYS у коллектора) — тогда на
//    глубине лет остаются только часовой и дневной.
//
// Во втором случае карта старого отрезка на мелком таймфрейме рисуется с
// часовым разрешением: колонка окажется уже бакета, то есть соседние колонки
// повторят одно значение. Это заметно грубее, но честнее пустого экрана —
// история сохранена, просто менее подробно.
const LEVEL_FALLBACK: Record<RollupLevel, RollupLevel[]> = {
  day: ["day", "hour", "minute"],
  hour: ["hour", "minute", "day"],
  minute: ["minute", "hour", "day"],
};

/**
 * Сколько колонок карты покрывает ОДИН бакет уровня.
 *
 * Колонка сетки и бакет rollup — разные величины, и бакет бывает шире. Тогда
 * его старт попадает в одну колонку, а соседние остаются пустыми, и карта
 * рисуется вертикальными полосами через пропуск.
 *
 * Так было видно на 4h: окно там 133 дня (TF_MS × CANDLES_IN_WINDOW), колонка
 * ≈13 часов, и если часовой уровень окно не покрывает и чтение уходит на
 * дневной, один суточный бакет приходится примерно на две колонки — вторая
 * оставалась пустой. На 1h этого нет: там колонка ≈3.3 часа при часовом
 * бакете, то есть в каждую колонку попадает несколько бакетов.
 */
export function bucketSpanCols(levelMs: number, fromMs: number, toMs: number, cols: number): number {
  const colMs = (toMs - fromMs) / Math.max(1, cols);
  if (!Number.isFinite(colMs) || colMs <= 0) return 1;
  return Math.max(1, Math.ceil(levelMs / colMs));
}

/**
 * Достраивает колонки, оставшиеся пустыми из-за того, что бакет шире колонки:
 * пустая колонка получает содержимое предыдущей заполненной, но не дальше чем
 * на ширину бакета (spanCols − 1 колонок).
 *
 * Это не «размазывание» данных, а восстановление их реальной длительности:
 * дневной бакет описывает стакан за целые сутки, а не за один их момент.
 * Ограничение по spanCols важно: настоящие дыры в данных (коллектор стоял)
 * шире бакета и остаются видимыми, как и должны.
 */
export function fillCoarseBucketGaps(grid: number[][], spanCols: number): void {
  if (spanCols <= 1) return;
  const isEmpty = (col: number[]) => !col.some((v) => v !== 0);
  let lastFilled = -1;
  for (let c = 0; c < grid.length; c++) {
    if (!isEmpty(grid[c])) { lastFilled = c; continue; }
    if (lastFilled < 0 || c - lastFilled >= spanCols) continue;
    grid[c] = grid[lastFilled].slice();
  }
}

// Длительность бакета уровня — допуск при проверке покрытия.
const LEVEL_MS: Record<RollupLevel, number> = {
  minute: 60_000,
  hour: 3600_000,
  day: 86_400_000,
};

// Какой доли окна достаточно, чтобы считать уровень пригодным. Не 100%:
// хвост уровня всегда отстаёт на минуту-другую (данные ещё пишутся), а
// требование полного покрытия отбрасывало бы уровень из-за этих минут и
// уводило чтение на более грубый.
const COVERAGE_ENOUGH = 0.9;

/**
 * Уровень, с которого читать окно: первый из списка, покрывающий его почти
 * целиком; если такого нет — покрывающий больше остальных.
 *
 * Оцениваем именно ДОЛЮ покрытия, а не факт «есть хоть что-то»: каскад
 * догоняет историю от старого к новому, и уровень с одним старым куском данных
 * иначе выигрывал бы у полного минутного слоя, оставляя свежую половину окна —
 * ровно ту, ради которой смотрят на карту, — пустой.
 *
 * Покрытие спрашиваем у таблиц СЧЁТЧИКОВ: они на порядки меньше ценовых
 * (одна строка на бакет против сотни), а наполняются с ними одним прогоном.
 */
async function pickCoveringLevel(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  candidates: RollupLevel[],
): Promise<RollupLevel | null> {
  let best: { level: RollupLevel; overlap: number } | null = null;

  for (const lvl of candidates) {
    const exFilter = exchange === "all" ? Prisma.empty : Prisma.sql`AND "exchange" = ${exchange}`;
    const rows = await prisma.$queryRaw<{ lo: Date | null; hi: Date | null }[]>`
      SELECT MIN("bucket") AS lo, MAX("bucket") AS hi
      FROM ${Prisma.raw(`"${ROLLUP_TABLES[lvl].snaps}"`)}
      WHERE "symbol" = ${symbol} ${exFilter}
    `;
    const lo = rows[0]?.lo?.getTime();
    const hi = rows[0]?.hi?.getTime();
    if (lo === undefined || hi === undefined) continue; // уровень пуст

    // Текущий бакет ещё набирается — считаем его частью покрытия.
    const slack = LEVEL_MS[lvl];
    const overlap = Math.min(toMs, hi + slack) - Math.max(fromMs, lo);
    if (overlap <= 0) continue;

    const coverage = overlap / (toMs - fromMs);
    if (coverage >= COVERAGE_ENOUGH) return lvl;
    if (!best || overlap > best.overlap) best = { level: lvl, overlap };
  }

  return best?.level ?? null;
}

export async function computeOrderflow(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  // level — форсировать уровень каскада вместо автоматического выбора. Нужен
  // тестам (сравнить, что уровни дают одну и ту же картинку) и отладке.
  opts: { bins?: number; cols?: number; level?: RollupLevel } = {},
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

  // Быстрый путь — из каскада rollup. Уровень выбирается по ширине колонки:
  // на окне в год колонка шириной 36 часов, и минутные бакеты в ней — это
  // сотни тысяч строк ради одного числа (см. rollupLevelFor).
  //
  // Но подходящий по ширине уровень может не ПОКРЫВАТЬ окно целиком: каскад
  // догоняет историю порциями, а минутный слой обрезан ретеншном. Поэтому
  // проверяем фактическое покрытие, а не «пусто/не пусто»: раньше уровень с
  // одним старым куском данных считался годным, и свежая половина окна —
  // ровно та, ради которой на карту и смотрят, — оставалась пустой.
  const colExprR = Prisma.sql`floor((extract(epoch from "bucket") * 1000 - ${fromMs}) / ${xspan} * ${cols})`;
  const level = opts.level ?? rollupLevelFor(fromMs, toMs, cols);
  const candidates = opts.level ? [opts.level] : LEVEL_FALLBACK[level];
  const usedLevel = await pickCoveringLevel(symbol, exchange, fromMs, toMs, candidates);
  let cells: { col: number; price: number; vol: number }[] = [];
  if (usedLevel) {
    cells = await prisma.$queryRaw<{ col: number; price: number; vol: number }[]>`
      SELECT ${colExprR}::int AS col, "price" AS price, SUM("volSum")::float8 AS vol
      FROM ${Prisma.raw(`"${ROLLUP_TABLES[usedLevel].prices}"`)}
      WHERE "symbol" = ${symbol} AND "bucket" >= ${from} AND "bucket" <= ${to} ${exFilter}
      GROUP BY col, "price"
    `;
  }
  let colStats: { col: number; n: number; ex: number }[];
  if (usedLevel) {
    colStats = await prisma.$queryRaw<{ col: number; n: number; ex: number }[]>`
      SELECT ${colExprR}::int AS col, SUM("snaps")::int AS n, COUNT(DISTINCT "exchange")::int AS ex
      FROM ${Prisma.raw(`"${ROLLUP_TABLES[usedLevel].snaps}"`)}
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
  // Бакет прочитанного уровня может быть шире колонки — тогда между колонками
  // остаются пустоты, которых в данных нет (см. fillCoarseBucketGaps).
  fillCoarseBucketGaps(grid, bucketSpanCols(LEVEL_MS[usedLevel ?? "minute"], fromMs, toMs, cols));
  let maxVal = 0;
  for (const col of grid) for (const v of col) if (v > maxVal) maxVal = v;
  const times = new Array(cols).fill(0).map((_, c) => Math.round(fromMs + ((c + 0.5) / cols) * xspan));

  // Профиль текущего стакана.
  //
  // Быстрый путь — таблица ObLatestBook (одна строка на symbol×exchange,
  // коллектор перезаписывает её на каждом тике): чтение по первичному ключу
  // вместо поиска MAX(t) коррелированным подзапросом по сырому ObSnapshot,
  // который сканировал окно дважды на КАЖДЫЙ опрос orderflow.
  //
  // Он применим только когда окно заканчивается «сейчас» — а /api/orderflow
  // всегда просит to = Date.now(). Для исторического окна (если такой вызов
  // появится) и пока таблица не наполнена — прежний путь по сырью.
  const isLive = Date.now() - toMs < 5 * 60_000;
  type BookLevel = { price: number; bidVol: number; askVol: number };
  let lastRows: { t: Date; exchange: string; price: number; bidVol: number; askVol: number }[] = [];

  if (isLive) {
    const books = await prisma.obLatestBook.findMany({
      where: { symbol, ...(exchange === "all" ? {} : { exchange }) },
      select: { t: true, exchange: true, levels: true },
    });
    for (const b of books) {
      // Прежняя выборка требовала, чтобы снапшот попадал в окно. Сохраняем это:
      // если коллектор стоит, строка протухла и профиль показывать по ней нельзя.
      if (b.t.getTime() < fromMs || b.t.getTime() > toMs) continue;
      for (const lvl of b.levels as unknown as BookLevel[]) {
        lastRows.push({ t: b.t, exchange: b.exchange, price: lvl.price, bidVol: lvl.bidVol, askVol: lvl.askVol });
      }
    }
  }

  if (lastRows.length === 0) {
    lastRows = await prisma.$queryRaw<
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
  }

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

// ─── Volume Profile (POC, VAL, VAH) ─────────────────────────────────────────

export type VolumeProfileLevel = {
  price: number;       // центр бина
  volume: number;      // суммарный объём на этом уровне
  isPoc: boolean;      // true = Point of Control
  isVa: boolean;       // true = внутри Value Area
  pct: number;         // процент от maxVolume (0-100)
};

export type VolumeProfile = {
  poc: number;           // Point of Control (цена)
  vah: number;           // Value Area High
  val: number;           // Value Area Low
  levels: VolumeProfileLevel[];
  totalVolume: number;
  pocVolume: number;     // объём на POC
  valueAreaVolume: number; // объём внутри VA
  valueAreaPct: number;  // 0.7 (настраивается)
  binSize: number;       // шаг цены
};

// Выбор интервала свечей в зависимости от длины периода.
function vpInterval(periodMs: number): string {
  if (periodMs <= 24 * 3_600_000) return "1h";
  if (periodMs <= 7 * 24 * 3_600_000) return "4h";
  return "1d";
}

// Volume Profile — горизонтальный профиль объёмов, показывающий распределение
// торгового объёма по ценовым уровням за выбранный период.
// Алгоритм:
//   1. Читаем ObCandle за период (цена high/low + volume)
//   2. Распределяем volume равномерно по ценовым уровням (price bins), которых
//      коснулась свеча (high → low)
//   3. Находим POC = уровень с максимальным объёмом
//   4. Вычисляем Value Area = 70% total volume, расширяясь от POC вверх/вниз
//   5. Возвращаем { poc, vah, val, levels[], totalVolume }
export async function computeVolumeProfile(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  opts?: { bins?: number; valueAreaPct?: number },
): Promise<VolumeProfile | null> {
  const bins = opts?.bins ?? 100;
  const valueAreaPct = opts?.valueAreaPct ?? 0.7;

  const interval = vpInterval(toMs - fromMs);
  const exFilter = exchange === "all" ? Prisma.empty : Prisma.sql`AND "exchange" = ${exchange}`;

  // 1. Читаем свечи за период.
  const candles = await prisma.$queryRaw<
    { t: Date; h: number; l: number; c: number; v: number }[]
  >`
    SELECT "t", "h", "l", "c", "v"
    FROM "ObCandle"
    WHERE "symbol" = ${symbol}
      AND "interval" = ${interval}
      AND "t" >= ${new Date(fromMs)}
      AND "t" <= ${new Date(toMs)}
      ${exFilter}
    ORDER BY "t" ASC
  `;

  if (candles.length === 0) return null;

  // 2. Определяем ценовой диапазон.
  let priceMin = Infinity;
  let priceMax = -Infinity;
  let totalVolume = 0;
  for (const c of candles) {
    if (c.h > priceMax) priceMax = c.h;
    if (c.l < priceMin) priceMin = c.l;
    totalVolume += c.v;
  }
  const pad = (priceMax - priceMin) * 0.02 || priceMax * 0.005;
  priceMin -= pad;
  priceMax += pad;
  const span = priceMax - priceMin || 1;
  const binSize = span / bins;

  // 3. Распределяем объём по бинам (равномерно по всему диапазону high-low свечи).
  const levels = new Array(bins).fill(0);
  for (const c of candles) {
    if (c.v <= 0) continue;
    const loBin = Math.max(0, Math.min(bins - 1, Math.floor((c.l - priceMin) / span * bins)));
    const hiBin = Math.max(0, Math.min(bins - 1, Math.floor((c.h - priceMin) / span * bins)));
    const count = hiBin - loBin + 1;
    const volPerBin = c.v / count;
    for (let b = loBin; b <= hiBin; b++) {
      levels[b] += volPerBin;
    }
  }

  // 4. Находим POC (Point of Control).
  let pocIdx = 0;
  let maxLevelVol = 0;
  for (let b = 0; b < bins; b++) {
    if (levels[b] > maxLevelVol) {
      maxLevelVol = levels[b];
      pocIdx = b;
    }
  }
  const poc = priceMin + (pocIdx + 0.5) * binSize;
  const pocVolume = levels[pocIdx];

  // 5. Вычисляем Value Area (расширяемся от POC, пока не наберём valueAreaPct).
  const target = totalVolume * valueAreaPct;
  let vaVolume = levels[pocIdx];
  let vaLo = pocIdx;
  let vaHi = pocIdx;
  // Расширяемся вверх и вниз, выбирая уровень с большим объёмом.
  while (vaVolume < target) {
    const nextLo = vaLo - 1;
    const nextHi = vaHi + 1;
    const loVol = nextLo >= 0 ? levels[nextLo] : -1;
    const hiVol = nextHi < bins ? levels[nextHi] : -1;

    if (loVol < 0 && hiVol < 0) break; // вышли за границы
    if (loVol >= hiVol && loVol >= 0) {
      vaLo = nextLo;
      vaVolume += loVol;
    } else if (hiVol >= 0) {
      vaHi = nextHi;
      vaVolume += hiVol;
    } else {
      break;
    }
  }
  const vah = priceMin + (vaHi + 0.5) * binSize;
  const val = priceMin + (vaLo + 0.5) * binSize;

  // 6. Строим массив уровней.
  const maxVol = maxLevelVol || 1;
  const resultLevels: VolumeProfileLevel[] = [];
  for (let b = 0; b < bins; b++) {
    const price = priceMin + (b + 0.5) * binSize;
    resultLevels.push({
      price,
      volume: levels[b],
      isPoc: b === pocIdx,
      isVa: b >= vaLo && b <= vaHi,
      pct: (levels[b] / maxVol) * 100,
    });
  }

  return {
    poc,
    vah,
    val,
    levels: resultLevels,
    totalVolume,
    pocVolume,
    valueAreaVolume: vaVolume,
    valueAreaPct,
    binSize,
  };
}

// ─── Divergence Scanner (цена vs дельта/CVD) ─────────────────────────────────

export type DivergenceType =
  | "regular_bullish"
  | "regular_bearish"
  | "hidden_bullish"
  | "hidden_bearish";

export type DivergenceSignal = {
  id: string;
  type: DivergenceType;
  strength: number; // 1-5
  t: number; // ms таймстемп второго экстремума (цена)
  pricePeak: number; // цена экстремума A
  priceTrough: number; // цена экстремума B
  deltaPeak: number; // дельта на экстремуме A
  deltaTrough: number; // дельта на экстремуме B
  bars: number; // расстояние между экстремумами в свечах
  confirmed: boolean;
  label: string; // "Regular Bearish", "Hidden Bullish" и т.д.
};

export type DivergenceResult = {
  signals: DivergenceSignal[];
  activeCount: number; // неподтверждённые (последние N свечей)
  totalCount: number;
};

// Обнаруживает дивергенции между ценой и дельтой/CVD.
// Алгоритм:
//   1. Читает свечи (ObCandle) и дельту (ObTrade) за период
//   2. Синхронизирует дельту со свечами (суммирует дельту по корзинам внутри свечи)
//   3. Находит экстремумы цены (peaks/troughs)
//   4. Для каждой пары соседних экстремумов сравнивает цену и дельту
//   5. Классифицирует: regular/hidden, bullish/bearish
export async function computeDivergence(
  symbol: string,
  exchange: string,
  range: string,
  fromMs: number,
  toMs: number,
  opts?: {
    minStrength?: number;
    lookbackBars?: number;
    minDivergenceBars?: number;
    maxDivergenceBars?: number;
  },
): Promise<DivergenceResult | null> {
  const minStrength = opts?.minStrength ?? 2;
  const lookbackBars = opts?.lookbackBars ?? 50;
  const minBars = opts?.minDivergenceBars ?? 5;
  const maxBars = opts?.maxDivergenceBars ?? 30;

  // 1. Получаем свечи и дельту.
  // live: false — дивергенции считаются по закрытым свечам, поход в Binance
  // за формирующейся свечой здесь только тратил бы ~366 мс на каждый опрос.
  const candles = await fetchOrderflowCandles(symbol, exchange, range, fromMs, toMs, { live: false });
  if (candles.length < minBars) return null;

  const deltaSeries = await computeDelta(symbol, exchange, fromMs, toMs);
  if (!deltaSeries) return null;

  // 2. Синхронизируем дельту со свечами: для каждой свечи суммируем дельту
  //    из корзин delta, попадающих в её временной диапазон.
  const stepMs = candles.length > 1 ? candles[1].t - candles[0].t : 60_000;
  const candleCount = Math.min(candles.length, lookbackBars);
  const startIdx = candles.length - candleCount;
  const candleDelta = new Array(candleCount).fill(0);
  const candleHigh = new Array(candleCount).fill(0);
  const candleLow = new Array(candleCount).fill(Infinity);

  // Оба массива (candles, deltaSeries.times) хронологически отсортированы и
  // окна свечей не перекрываются — вместо полного прохода по deltaSeries на
  // каждую свечу (O(candleCount × deltaSeries.length)) двигаем один указатель
  // только вперёд (two-pointer, O(candleCount + deltaSeries.length)).
  let deltaPtr = 0;
  for (let i = 0; i < candleCount; i++) {
    const ci = startIdx + i;
    const c = candles[ci];
    const cStart = c.t;
    const cEnd = c.t + stepMs;

    while (deltaPtr < deltaSeries.times.length && deltaSeries.times[deltaPtr] < cStart) deltaPtr++;
    while (deltaPtr < deltaSeries.times.length && deltaSeries.times[deltaPtr] < cEnd) {
      candleDelta[i] += deltaSeries.delta[deltaPtr];
      deltaPtr++;
    }

    candleHigh[i] = c.h;
    candleLow[i] = c.l;
  }

  // 3. Находим экстремумы цены.
  const peaks: number[] = [];
  const troughs: number[] = [];

  for (let i = 1; i < candleCount - 1; i++) {
    if (candleHigh[i] > candleHigh[i - 1] && candleHigh[i] > candleHigh[i + 1]) {
      peaks.push(i);
    }
    if (candleLow[i] < candleLow[i - 1] && candleLow[i] < candleLow[i + 1]) {
      troughs.push(i);
    }
  }

  // 4. Обнаруживаем дивергенции на peaks.
  const signals: DivergenceSignal[] = [];

  for (let p = 0; p < peaks.length - 1; p++) {
    const i1 = peaks[p];
    const i2 = peaks[p + 1];
    const bars = i2 - i1;
    if (bars < minBars || bars > maxBars) continue;

    const priceChange = candleHigh[i2] - candleHigh[i1];
    const deltaChange = candleDelta[i2] - candleDelta[i1];

    // Regular Bearish: цена делает HH, дельта делает LH
    if (priceChange > 0 && deltaChange < 0) {
      const strength = Math.min(5, Math.max(1, Math.floor(bars / 3) + 1));
      const ci = startIdx + i2;
      signals.push({
        id: `rb-${ci}-${candles[ci].t}`,
        type: "regular_bearish",
        strength,
        t: candles[ci].t,
        pricePeak: candleHigh[i2],
        priceTrough: candleHigh[i1],
        deltaPeak: candleDelta[i1],
        deltaTrough: candleDelta[i2],
        bars,
        confirmed: false,
        label: "Regular Bearish",
      });
    }

    // Hidden Bearish: цена делает LH (продолжение нисходящего тренда),
    // дельта делает HH. Экстремум "i2" — второй, более поздний пик, и он же
    // задаёт t (время маркера) — pricePeak ДОЛЖЕН совпадать с i2, иначе
    // отрисовка (DivergenceOverlay: `isBearish → sy(sig.pricePeak)`) берёт
    // X от свечи i2, а Y — от цены совсем другой свечи (i1, до 30 баров
    // назад), и маркер "улетает" в произвольную точку графика.
    if (priceChange < 0 && deltaChange > 0) {
      const strength = Math.min(5, Math.max(1, Math.floor(bars / 3) + 1));
      const ci = startIdx + i2;
      signals.push({
        id: `hb-${ci}-${candles[ci].t}`,
        type: "hidden_bearish",
        strength,
        t: candles[ci].t,
        pricePeak: candleHigh[i2],
        priceTrough: candleHigh[i1],
        deltaPeak: candleDelta[i1],
        deltaTrough: candleDelta[i2],
        bars,
        confirmed: false,
        label: "Hidden Bearish",
      });
    }
  }

  // 5. Обнаруживаем дивергенции на troughs.
  for (let t = 0; t < troughs.length - 1; t++) {
    const i1 = troughs[t];
    const i2 = troughs[t + 1];
    const bars = i2 - i1;
    if (bars < minBars || bars > maxBars) continue;

    const priceChange = candleLow[i2] - candleLow[i1];
    const deltaChange = candleDelta[i2] - candleDelta[i1];

    // Regular Bullish: цена делает LL, дельта делает HL
    if (priceChange < 0 && deltaChange > 0) {
      const strength = Math.min(5, Math.max(1, Math.floor(bars / 3) + 1));
      const ci = startIdx + i2;
      signals.push({
        id: `rbu-${ci}-${candles[ci].t}`,
        type: "regular_bullish",
        strength,
        t: candles[ci].t,
        pricePeak: candleLow[i1],
        priceTrough: candleLow[i2],
        deltaPeak: candleDelta[i1],
        deltaTrough: candleDelta[i2],
        bars,
        confirmed: false,
        label: "Regular Bullish",
      });
    }

    // Hidden Bullish: цена делает HL (продолжение восходящего тренда),
    // дельта делает LL. Здесь poля уже согласованы с t (i2), т.к. рендер
    // для bullish берёт sy(sig.priceTrough) = candleLow[i2] — менять не нужно,
    // только исправляем тип/лейбл (был перепутан с hidden_bearish, см. блок
    // на peaks выше).
    if (priceChange > 0 && deltaChange < 0) {
      const strength = Math.min(5, Math.max(1, Math.floor(bars / 3) + 1));
      const ci = startIdx + i2;
      signals.push({
        id: `hbe-${ci}-${candles[ci].t}`,
        type: "hidden_bullish",
        strength,
        t: candles[ci].t,
        pricePeak: candleLow[i1],
        priceTrough: candleLow[i2],
        deltaPeak: candleDelta[i1],
        deltaTrough: candleDelta[i2],
        bars,
        confirmed: false,
        label: "Hidden Bullish",
      });
    }
  }

  // 6. Фильтруем по minStrength.
  const filtered = signals.filter((s) => s.strength >= minStrength);

  // 7. Активные: сигналы в последних lookbackBars/4 свечей.
  const activeThreshold = candleCount * 0.25;
  const activeCount = filtered.filter((s) => {
    const idx = ((s.t - candles[0].t) / stepMs) - startIdx;
    return idx >= candleCount - activeThreshold;
  }).length;

  return {
    signals: filtered,
    activeCount,
    totalCount: filtered.length,
  };
}

// ─── Feature 3: Bid/Ask Imbalance + Speed of Tape ─────────────────────────

export type ImbalanceAlert = {
  t: number;
  type: "high_imbalance" | "low_imbalance" | "imbalance_flip";
  value: number;
  message: string;
};

export type Imbalance = {
  times: number[];
  ratio: number[]; // (ask - bid) / (bid + ask), -1..1
  fullBid: number[];
  fullAsk: number[];
  nearBid: number[];
  nearAsk: number[];
  alerts: ImbalanceAlert[];
};

export type SpeedOfTape = {
  times: number[];
  tradesPerMin: number[];
  maxSpeed: number;
  avgSpeed: number;
  spikes: { t: number; speed: number; threshold: number }[];
};

/**
 * Преобразует BaSeries (0..1 ratio) в Imbalance (-1..1 ratio).
 * - ratio = (ask - bid) / (bid + ask) → -1 (только bid) .. 0 (равно) .. +1 (только ask)
 * - Ищет алерты: high_imbalance (>0.7), low_imbalance (<-0.7), imbalance_flip (переход через 0)
 */
export async function computeImbalance(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  cols = 240,
): Promise<Imbalance | null> {
  const ba = await computeBA(symbol, exchange, fromMs, toMs, cols);
  if (!ba) return null;

  const n = ba.times.length;
  const fullBid = new Array(n).fill(0);
  const fullAsk = new Array(n).fill(0);
  const nearBid = new Array(n).fill(0);
  const nearAsk = new Array(n).fill(0);
  const ratio = ba.full.map((r, i) => {
    // ba.full = bid/(bid+ask), 0..1
    const bid = r;
    const ask = 1 - r;
    // fullBid/fullAsk — восстановленные объёмы (пропорциональные)
    fullBid[i] = bid;
    fullAsk[i] = ask;
    // near: то же для near ratio
    const nr = ba.near[i];
    nearBid[i] = nr;
    nearAsk[i] = 1 - nr;
    // imbalance = (ask - bid) / (bid + ask) = (1 - 2*bid) / 1 = 1 - 2*bid
    return 1 - 2 * bid;
  });

  // Поиск алертов.
  const alerts: ImbalanceAlert[] = [];
  const HIGH_THRESHOLD = 0.7;
  const LOW_THRESHOLD = -0.7;
  let prevRatio = ratio[0] ?? 0;
  for (let i = 0; i < n; i++) {
    const r = ratio[i];
    if (r > HIGH_THRESHOLD) {
      alerts.push({
        t: ba.times[i],
        type: "high_imbalance",
        value: r,
        message: `Высокий дисбаланс: ask=${((1 + r) / 2 * 100).toFixed(0)}%`,
      });
    } else if (r < LOW_THRESHOLD) {
      alerts.push({
        t: ba.times[i],
        type: "low_imbalance",
        value: r,
        message: `Низкий дисбаланс: bid=${((1 - r) / 2 * 100).toFixed(0)}%`,
      });
    }
    // Переход через 0 (flip).
    if (i > 0 && prevRatio * r < 0) {
      alerts.push({
        t: ba.times[i],
        type: "imbalance_flip",
        value: r,
        message: prevRatio < 0 ? "Bid→Ask flip" : "Ask→Bid flip",
      });
    }
    prevRatio = r;
  }

  return {
    times: ba.times,
    ratio,
    fullBid,
    fullAsk,
    nearBid,
    nearAsk,
    alerts,
  };
}

/**
 * Speed of Tape — количество сделок в минуту.
 *
 * БЫЛО: COUNT(*) по ObTrade. Коллектор пишет ОДНУ строку на свой тик, агрегируя
 * все сделки интервала, поэтому счёт строк давал частоту опроса коллектора
 * (≈60/snapshotMs), а не активность рынка — метрика показывала почти константу.
 * СТАЛО: SUM("trades") — реальное число печатей, которое коллектор теперь
 * считает (см. collector/trades.mjs).
 *
 * Источник — минутный ObTradeRollup, что совпадает с бакетом метрики один в
 * один. Fallback на сырьё — пока rollup не наполнен; у строк ObTrade, записанных
 * до появления счётчика, trades = 0, поэтому на старой истории метрика покажет
 * ноль вместо прежней бессмысленной константы.
 */
export async function computeSpeedOfTape(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  bucketMs = 60_000, // 1 минута
): Promise<SpeedOfTape | null> {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const xspan = toMs - fromMs || 1;
  const cols = Math.max(1, Math.ceil(xspan / bucketMs));

  const exFilter = exchange === "all" ? Prisma.empty : Prisma.sql`AND "exchange" = ${exchange}`;
  const bucketExprR = Prisma.sql`floor((extract(epoch from "bucket") * 1000 - ${fromMs}) / ${bucketMs})::int`;

  // Алиас не "bucket" — см. пояснение в computeFootprint: иначе GROUP BY
  // связался бы с одноимённой колонкой ObTradeRollup. Здесь бакет метрики
  // совпадает с минутой rollup, так что итог случайно сходился, но при другом
  // bucketMs результат был бы неверным.
  let rows = await prisma.$queryRaw<{ slot: number; cnt: number }[]>`
    SELECT ${bucketExprR} AS slot, SUM("trades")::int AS cnt
    FROM "ObTradeRollup"
    WHERE "symbol" = ${symbol} AND "bucket" >= ${from} AND "bucket" < ${to} ${exFilter}
    GROUP BY slot
    ORDER BY slot
  `;
  if (rows.length === 0) {
    const bucketExpr = Prisma.sql`floor((extract(epoch from "t") * 1000 - ${fromMs}) / ${bucketMs})::int`;
    rows = await prisma.$queryRaw<{ slot: number; cnt: number }[]>`
      SELECT ${bucketExpr} AS slot, SUM("trades")::int AS cnt
      FROM "ObTrade"
      WHERE "symbol" = ${symbol} AND "t" >= ${from} AND "t" < ${to} ${exFilter}
      GROUP BY slot
      ORDER BY slot
    `;
  }

  if (rows.length === 0) return null;

  // Заполняем массив.
  const tradesPerMin = new Array(cols).fill(0);
  for (const r of rows) {
    const c = Math.max(0, Math.min(cols - 1, r.slot));
    tradesPerMin[c] += r.cnt;
  }

  const times = new Array(cols).fill(0).map((_, c) => Math.round(fromMs + ((c + 0.5) / cols) * xspan));

  // Статистика.
  const maxSpeed = Math.max(...tradesPerMin);
  const avgSpeed = tradesPerMin.reduce((a, b) => a + b, 0) / cols;

  // Всплески: > 2σ от среднего.
  const stdDev = Math.sqrt(tradesPerMin.reduce((sum, v) => sum + (v - avgSpeed) ** 2, 0) / cols);
  const threshold = avgSpeed + 2 * stdDev;
  const spikes = tradesPerMin
    .map((v, i) => (v > threshold ? { t: times[i], speed: v, threshold } : null))
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return { times, tradesPerMin, maxSpeed, avgSpeed, spikes };
}

// ─── Feature 4: Absorption Pattern Detector ────────────────────────────────

export type AbsorptionSignal = {
  t: number;                    // ms таймстемп первой свечи паттерна
  price: number;                // средняя цена (mid)
  range: number;                // диапазон (high - low) в пунктах
  volume: number;               // объём (buyVol + sellVol)
  avgVolume: number;            // средний объём за N предыдущих свечей
  volumeMultiplier: number;     // volume / avgVolume
  deltaRatio: number;           // |buy - sell| / (buy + sell), 0..1
  duration: number;             // количество свечей паттерна
  strength: number;             // 1-5
  label: string;                // "Absorption", "Strong Absorption"
};

export type AbsorptionResult = {
  signals: AbsorptionSignal[];
  activeCount: number;
};

/**
 * Absorption Pattern Detector — ищет свечи/группы свечей, где цена
 * торгуется в узком диапазоне, но объём сделок аномально высок,
 * а дельта около нуля. Это признак накопления/распределения: крупный
 * игрок "впитывает" ликвидность, не давая цене уйти.
 *
 * Использует ObFootprint (buyVol, sellVol) и ObCandle (high, low).
 */
export async function computeAbsorption(
  symbol: string,
  exchange: string,
  range: string,
  fromMs: number,
  toMs: number,
  opts?: {
    minVolumeMultiplier?: number; // объём в N раз выше среднего
    maxRangeBars?: number;        // макс. диапазон в свечах
    maxDeltaRatio?: number;       // макс. |delta| / volume
    minCandles?: number;          // мин. длительность паттерна
    lookback?: number;            // сколько свечей для среднего объёма
  },
): Promise<AbsorptionResult | null> {
  const minVolumeMultiplier = opts?.minVolumeMultiplier ?? 2.0;
  const maxRangeBars = opts?.maxRangeBars ?? 3;
  const maxDeltaRatio = opts?.maxDeltaRatio ?? 0.15;
  const minCandles = opts?.minCandles ?? 2;
  const lookback = opts?.lookback ?? 10;

  // 1. Получаем свечи.
  // live: false — см. computeDivergence: абсорбция тоже про закрытые свечи.
  const candles = await fetchOrderflowCandles(symbol, exchange, range, fromMs, toMs, { live: false });
  if (candles.length < lookback + minCandles) return null;

  // 2. Получаем footprint (buyVol, sellVol) для каждой свечи.
  // Группируем ObFootprint по свечным интервалам.
  const stepMs = candles.length > 1 ? candles[1].t - candles[0].t : 60_000;
  const from = new Date(fromMs);
  const to = new Date(toMs);

  // Считаем колонку свечи и сумму buy/sell для каждой.
  const colExpr = Prisma.sql`floor((extract(epoch from "t") * 1000 - ${fromMs}) / ${stepMs})::int`;
  const exFilter = exchange === "all" ? Prisma.empty : Prisma.sql`AND "exchange" = ${exchange}`;

  const fpRows = await prisma.$queryRaw<{ col: number; buy: number; sell: number }[]>`
    SELECT ${colExpr} AS col,
           SUM("buyVol")::float8 AS buy,
           SUM("sellVol")::float8 AS sell
    FROM "ObFootprint"
    WHERE "symbol" = ${symbol} AND "t" >= ${from} AND "t" < ${to} ${exFilter}
    GROUP BY col
    ORDER BY col
  `;

  if (fpRows.length === 0) return null;

  // Маппим footprint к свечам.
  const candleCount = candles.length;
  const candleVol = new Array(candleCount).fill(0);
  const candleBuy = new Array(candleCount).fill(0);
  const candleSell = new Array(candleCount).fill(0);
  const candleRange = candles.map((c) => c.h - c.l);

  for (const r of fpRows) {
    const c = Math.max(0, Math.min(candleCount - 1, r.col));
    candleBuy[c] += r.buy;
    candleSell[c] += r.sell;
    candleVol[c] += r.buy + r.sell;
  }

  // 3. Ищем absorption-паттерны.
  const signals: AbsorptionSignal[] = [];
  let i = lookback;
  while (i < candleCount) {
    // Проверяем: узкий диапазон?
    const avgRange = candleRange.slice(i - lookback, i).reduce((a, b) => a + b, 0) / lookback;
    if (avgRange <= 0 || candleRange[i] > avgRange * maxRangeBars) {
      i++;
      continue;
    }

    // Объём выше среднего?
    const avgVol = candleVol.slice(i - lookback, i).reduce((a, b) => a + b, 0) / lookback;
    if (avgVol <= 0 || candleVol[i] < avgVol * minVolumeMultiplier) {
      i++;
      continue;
    }

    // Дельта около нуля?
    const totalVol = candleBuy[i] + candleSell[i];
    if (totalVol <= 0) { i++; continue; }
    const deltaRatio = Math.abs(candleBuy[i] - candleSell[i]) / totalVol;
    if (deltaRatio > maxDeltaRatio) {
      i++;
      continue;
    }

    // Нашли начало паттерна — расширяем пока условия выполняются.
    const startIdx = i;
    let j = i + 1;
    while (j < candleCount) {
      const jAvgRange = candleRange.slice(j - lookback, j).reduce((a, b) => a + b, 0) / lookback;
      const jAvgVol = candleVol.slice(j - lookback, j).reduce((a, b) => a + b, 0) / lookback;
      const jVol = candleBuy[j] + candleSell[j];
      const jDelta = jVol > 0 ? Math.abs(candleBuy[j] - candleSell[j]) / jVol : 1;

      if (jAvgRange <= 0 || candleRange[j] > jAvgRange * maxRangeBars) break;
      if (jAvgVol <= 0 || jVol < jAvgVol * minVolumeMultiplier) break;
      if (jDelta > maxDeltaRatio) break;
      j++;
    }
    const duration = j - startIdx;

    if (duration >= minCandles) {
      // Собираем статистику за весь паттерн.
      let totalBuy = 0, totalSell = 0, totalVolPat = 0, maxPrice = -Infinity, minPrice = Infinity;
      for (let k = startIdx; k < j; k++) {
        totalBuy += candleBuy[k];
        totalSell += candleSell[k];
        totalVolPat += candleVol[k];
        if (candles[k].h > maxPrice) maxPrice = candles[k].h;
        if (candles[k].l < minPrice) minPrice = candles[k].l;
      }
      const avgVolPat = candleVol.slice(startIdx - lookback, startIdx).reduce((a, b) => a + b, 0) / lookback;
      const volMult = avgVolPat > 0 ? totalVolPat / (avgVolPat * duration) : 0;
      const patDelta = totalVolPat > 0 ? Math.abs(totalBuy - totalSell) / totalVolPat : 0;
      const patRange = maxPrice - minPrice;
      const avgRangePat = candleRange.slice(startIdx - lookback, startIdx).reduce((a, b) => a + b, 0) / lookback;

      // Сила сигнала: 1-5
      let strength = 1;
      if (volMult > 4) strength += 2;
      else if (volMult > 3) strength += 1;
      if (patDelta < 0.05) strength += 1; // очень чистая дельта
      if (patRange < avgRangePat * 0.5) strength += 1; // очень узкий диапазон
      if (duration >= 4) strength += 1;
      strength = Math.min(5, Math.max(1, strength));

      signals.push({
        t: candles[startIdx].t,
        price: (maxPrice + minPrice) / 2,
        range: patRange,
        volume: totalVolPat,
        avgVolume: avgVolPat * duration,
        volumeMultiplier: volMult,
        deltaRatio: patDelta,
        duration,
        strength,
        label: strength >= 4 ? "Strong Absorption" : "Absorption",
      });

      i = j; // Пропускаем свечи паттерна.
    } else {
      i++;
    }
  }

  // Активные: последние 3 свечи
  const activeCount = signals.filter((s) => {
    const idx = candles.findIndex((c) => c.t === s.t);
    return idx >= 0 && idx >= candleCount - 3;
  }).length;

  return { signals, activeCount };
}
