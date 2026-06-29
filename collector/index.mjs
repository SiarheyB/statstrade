// Collector-сервис: для каждой пары (биржа × символ) поддерживает локальный
// стакан, раз в SNAPSHOT_MS бинует уровни по цене в пределах ±DEPTH_PCT от mid,
// фильтрует шум и пишет агрегаты в Postgres (таблица ObSnapshot). Периодически
// чистит данные старше RETENTION_DAYS. Поднимает HTTP healthcheck на PORT.
//
// Запуск:  node collector/index.mjs   (нужен DATABASE_URL)
// Конфиг через ENV — см. .env.example.

import http from "node:http";
import pg from "pg";
import { createOrderBook } from "./orderbook.mjs"; // binance futures/spot
import { createBybitBook } from "./bybit.mjs";
import { createOkxBook } from "./okx.mjs";
import { createTradeFeed } from "./trades.mjs";

const cfg = {
  symbols: (process.env.SYMBOLS ?? "BTCUSDT").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean),
  exchanges: (process.env.EXCHANGES ?? "binance-futures").split(",").map((s) => s.trim()).filter(Boolean),
  binSize: Number(process.env.BIN_SIZE ?? 25),
  snapshotMs: Number(process.env.SNAPSHOT_MS ?? 2000),
  depthPct: Number(process.env.DEPTH_PCT ?? 0.02),
  retentionDays: Number(process.env.RETENTION_DAYS ?? 7),
  noiseMinNotional: Number(process.env.NOISE_MIN_NOTIONAL ?? 50000),
  bigNotional: Number(process.env.BIG_NOTIONAL ?? 100000),
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT ?? 8080),
  metricsToken: process.env.COLLECTOR_METRICS_TOKEN ?? "",
};

if (!cfg.databaseUrl) {
  console.error("[fatal] DATABASE_URL не задан");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 4 });
const RUN_MS = Number(process.env.RUN_MS ?? 0);

// Шаг ценового бина под символ. Приоритет: ENV BIN_SIZE_<SYMBOL> → карта
// дефолтов → запасной cfg.binSize. Дефолты подобраны под типичную цену (~4 б.п.).
const DEFAULT_BIN = {
  BTCUSDT: 25,
  ETHUSDT: 1,
  BNBUSDT: 0.5,
  SOLUSDT: 0.1,
  XRPUSDT: 0.0005,
  DOGEUSDT: 0.0001,
  ADAUSDT: 0.0005,
  AVAXUSDT: 0.02,
  LINKUSDT: 0.01,
  TONUSDT: 0.005,
};
function binSizeFor(symbol) {
  const env = process.env[`BIN_SIZE_${symbol}`];
  if (env) return Number(env);
  return DEFAULT_BIN[symbol] ?? cfg.binSize;
}

const FACTORY = {
  "binance-futures": (symbol, h) => createOrderBook({ symbol, market: "futures", onResync: h.onResync, onError: h.onError }),
  "binance-spot": (symbol, h) => createOrderBook({ symbol, market: "spot", onResync: h.onResync, onError: h.onError }),
  "bybit-futures": (symbol, h) => createBybitBook({ symbol, onResync: h.onResync, onError: h.onError }),
  "okx-futures": (symbol, h) => createOkxBook({ symbol, onResync: h.onResync, onError: h.onError }),
};

// Создаём по книге на каждую пару (биржа × символ).
const feeds = [];
for (const exchange of cfg.exchanges) {
  const make = FACTORY[exchange];
  if (!make) {
    console.warn(`[skip] неизвестная биржа: ${exchange}`);
    continue;
  }
  for (const symbol of cfg.symbols) {
    const tag = `${exchange}:${symbol}`;
    const book = make(symbol, {
      onResync: (where) => console.warn(`[resync] ${tag} (${where})`),
      onError: (err) => console.error(`[ob] ${tag} ${err.message}`),
    });
    feeds.push({ exchange, symbol, book, binSize: binSizeFor(symbol) });
  }
}

// Лента сделок (дельта + footprint + крупные ордера) — по одному потоку на
// каждую пару (биржа × символ), как и стаканы.
const tradeFeeds = [];
for (const exchange of cfg.exchanges) {
  for (const symbol of cfg.symbols) {
    const tf = createTradeFeed({
      exchange,
      symbol,
      binSize: binSizeFor(symbol),
      bigNotional: cfg.bigNotional,
      onError: (e) => console.error(`[trades] ${exchange}:${symbol} ${e.message}`),
    });
    if (tf.supported) tradeFeeds.push({ symbol, exchange, trades: tf });
  }
}

function binSide(map, lo, hi, binSize) {
  const acc = new Map();
  for (const [p, q] of map) {
    const price = Number(p);
    if (price < lo || price > hi) continue;
    const center = Math.round(price / binSize) * binSize;
    acc.set(center, (acc.get(center) ?? 0) + q);
  }
  return acc;
}

// Накопительные метрики наполнения — отдаются через /metrics для админ-панели
// Next.js (раздел «Карта ордеров»). Ключ — `${exchange}:${symbol}`.
const startedAt = Date.now();
const metrics = new Map(); // tag -> { obRows, obLastBins, deltaRows, fpRows, bigRows, lastWriteAt, writeErrors }
function metricFor(tag) {
  let m = metrics.get(tag);
  if (!m) {
    m = { obRows: 0, obLastBins: 0, deltaRows: 0, fpRows: 0, bigRows: 0, lastWriteAt: null, writeErrors: 0 };
    metrics.set(tag, m);
  }
  return m;
}

function rowsForFeed(feed, t) {
  const { book, binSize } = feed;
  if (!book.synced) return { rows: [], mid: null };
  const bb = book.bestBid();
  const ba = book.bestAsk();
  if (!bb || !ba) return { rows: [], mid: null };
  const mid = (bb.price + ba.price) / 2;
  const lo = mid * (1 - cfg.depthPct);
  const hi = mid * (1 + cfg.depthPct);
  const bidBins = binSide(book.bids, lo, hi, binSize);
  const askBins = binSide(book.asks, lo, hi, binSize);
  const centers = new Set([...bidBins.keys(), ...askBins.keys()]);
  const out = [];
  for (const c of centers) {
    const bidVol = bidBins.get(c) ?? 0;
    const askVol = askBins.get(c) ?? 0;
    if ((bidVol + askVol) * c < cfg.noiseMinNotional) continue;
    out.push([feed.symbol, feed.exchange, t, c, bidVol, askVol]);
  }
  return { rows: out, mid };
}

// Накопитель минутных rollup-бакетов. Снапшоты копятся в памяти и сбрасываются в
// БД, когда минута завершилась (см. flushRollup). Ключ бакета — `${symbol}|${exchange}|${bucketMs}`.
const rollup = new Map(); // key -> { symbol, exchange, bucketMs, snaps, midSum, prices: Map<price,{vol,bid,ask}> }

function accumulateRollup(symbol, exchange, t, rows, mid) {
  if (mid == null || rows.length === 0) return;
  const bucketMs = Math.floor(t.getTime() / 60_000) * 60_000;
  const key = `${symbol}|${exchange}|${bucketMs}`;
  let e = rollup.get(key);
  if (!e) {
    e = { symbol, exchange, bucketMs, snaps: 0, midSum: 0, prices: new Map() };
    rollup.set(key, e);
  }
  e.snaps += 1;
  e.midSum += mid;
  for (const r of rows) {
    const price = r[3];
    const bid = r[4];
    const ask = r[5];
    const cell = e.prices.get(price) ?? { vol: 0, bid: 0, ask: 0 };
    cell.vol += bid + ask;
    cell.bid += bid;
    cell.ask += ask;
    e.prices.set(price, cell);
  }
}

// Сбрасываем в БД все бакеты, чья минута уже завершилась (bucketMs < текущей
// минуты). Upsert (ON CONFLICT) — на случай рестарта коллектора посреди минуты.
async function flushRollup(now) {
  const curBucket = Math.floor(now.getTime() / 60_000) * 60_000;
  for (const [key, e] of rollup) {
    if (e.bucketMs >= curBucket) continue;
    rollup.delete(key);
    if (e.snaps === 0 || e.prices.size === 0) continue;
    const bucket = new Date(e.bucketMs);
    try {
      await pool.query(
        `INSERT INTO "ObRollupBucket" ("symbol","exchange","bucket","snaps","midSum")
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT ("symbol","exchange","bucket")
         DO UPDATE SET "snaps" = "ObRollupBucket"."snaps" + EXCLUDED."snaps",
                       "midSum" = "ObRollupBucket"."midSum" + EXCLUDED."midSum"`,
        [e.symbol, e.exchange, bucket, e.snaps, e.midSum],
      );
      const values = [];
      const params = [];
      let i = 0;
      for (const [price, cell] of e.prices) {
        const b = i * 7;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
        params.push(e.symbol, e.exchange, bucket, price, cell.vol, cell.bid, cell.ask);
        i += 1;
      }
      await pool.query(
        `INSERT INTO "ObSnapshotRollup" ("symbol","exchange","bucket","price","volSum","bidSum","askSum")
         VALUES ${values.join(",")}
         ON CONFLICT ("symbol","exchange","bucket","price")
         DO UPDATE SET "volSum" = "ObSnapshotRollup"."volSum" + EXCLUDED."volSum",
                       "bidSum" = "ObSnapshotRollup"."bidSum" + EXCLUDED."bidSum",
                       "askSum" = "ObSnapshotRollup"."askSum" + EXCLUDED."askSum"`,
        params,
      );
    } catch (err) {
      console.error(`[rollup] flush ошибка ${key}: ${err.message}`);
    }
  }
}

async function writeSnapshot() {
  const t = new Date();
  const rows = [];
  for (const feed of feeds) {
    const { rows: r, mid } = rowsForFeed(feed, t);
    const m = metricFor(`${feed.exchange}:${feed.symbol}`);
    m.obRows += r.length;
    m.obLastBins = r.length;
    m.lastWriteAt = t.toISOString();
    rows.push(...r);
    accumulateRollup(feed.symbol, feed.exchange, t, r, mid);
  }
  // Сбрасываем завершённые минутные бакеты в rollup-таблицы (не блокирует запись
  // сырых снапшотов — flush идёт после основного INSERT ниже).

  if (rows.length > 0) {
    const values = [];
    const params = [];
    rows.forEach((r, i) => {
      const b = i * 6;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
      params.push(...r);
    });
    try {
      await pool.query(
        `INSERT INTO "ObSnapshot" ("symbol","exchange","t","price","bidVol","askVol") VALUES ` +
          values.join(","),
        params,
      );
    } catch (err) {
      console.error(`[write] ObSnapshot ошибка: ${err.message}`);
    }
  }

  // Дельта (ObTrade) + footprint (ObFootprint) из ленты сделок.
  const tRows = [];
  const fpRows = [];
  const bigRows = [];
  for (const tf of tradeFeeds) {
    const { buyVol, sellVol, footprint, big } = tf.trades.drain();
    const m = metricFor(`${tf.exchange}:${tf.symbol}`);
    if (buyVol !== 0 || sellVol !== 0) { tRows.push([tf.symbol, tf.exchange, t, buyVol, sellVol]); m.deltaRows += 1; }
    for (const lvl of footprint) {
      if (lvl.buy === 0 && lvl.sell === 0) continue;
      fpRows.push([tf.symbol, tf.exchange, t, lvl.price, lvl.buy, lvl.sell]);
      m.fpRows += 1;
    }
    for (const bt of big) {
      bigRows.push([tf.symbol, tf.exchange, new Date(bt.t), bt.price, bt.qty, bt.side]);
      m.bigRows += 1;
    }
  }
  if (tRows.length > 0) {
    const values = [];
    const params = [];
    tRows.forEach((r, i) => {
      const b = i * 5;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
      params.push(...r);
    });
    try {
      await pool.query(
        `INSERT INTO "ObTrade" ("symbol","exchange","t","buyVol","sellVol") VALUES ` + values.join(","),
        params,
      );
    } catch (err) {
      console.error(`[write] ObTrade ошибка: ${err.message}`);
    }
  }
  if (fpRows.length > 0) {
    const values = [];
    const params = [];
    fpRows.forEach((r, i) => {
      const b = i * 6;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
      params.push(...r);
    });
    try {
      await pool.query(
        `INSERT INTO "ObFootprint" ("symbol","exchange","t","price","buyVol","sellVol") VALUES ` + values.join(","),
        params,
      );
    } catch (err) {
      console.error(`[write] ObFootprint ошибка: ${err.message}`);
    }
  }

  if (bigRows.length > 0) {
    const values = [];
    const params = [];
    bigRows.forEach((r, i) => {
      const b = i * 6;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
      params.push(...r);
    });
    try {
      await pool.query(
        `INSERT INTO "ObBigTrade" ("symbol","exchange","t","price","qty","side") VALUES ` + values.join(","),
        params,
      );
    } catch (err) {
      console.error(`[write] ObBigTrade ошибка: ${err.message}`);
    }
  }

  await flushRollup(t);

  const synced = feeds.filter((f) => f.book.synced).length;
  console.log(`[write] t=${t.toISOString()} ob=${rows.length} delta=${tRows.length} fp=${fpRows.length} big=${bigRows.length} feeds=${synced}/${feeds.length}`);
}

async function pruneOld() {
  try {
    const r1 = await pool.query(
      `DELETE FROM "ObSnapshot" WHERE "t" < NOW() - ($1 || ' days')::interval`,
      [String(cfg.retentionDays)],
    );
    const r2 = await pool.query(
      `DELETE FROM "ObTrade" WHERE "t" < NOW() - ($1 || ' days')::interval`,
      [String(cfg.retentionDays)],
    );
    const r3 = await pool.query(
      `DELETE FROM "ObFootprint" WHERE "t" < NOW() - ($1 || ' days')::interval`,
      [String(cfg.retentionDays)],
    );
    const r4 = await pool.query(
      `DELETE FROM "ObBigTrade" WHERE "t" < NOW() - ($1 || ' days')::interval`,
      [String(cfg.retentionDays)],
    );
    const r5 = await pool.query(
      `DELETE FROM "ObSnapshotRollup" WHERE "bucket" < NOW() - ($1 || ' days')::interval`,
      [String(cfg.retentionDays)],
    );
    const r6 = await pool.query(
      `DELETE FROM "ObRollupBucket" WHERE "bucket" < NOW() - ($1 || ' days')::interval`,
      [String(cfg.retentionDays)],
    );
    const n =
      (r1.rowCount ?? 0) + (r2.rowCount ?? 0) + (r3.rowCount ?? 0) +
      (r4.rowCount ?? 0) + (r5.rowCount ?? 0) + (r6.rowCount ?? 0);
    if (n) console.log(`[prune] удалено ${n} старых строк`);
  } catch (err) {
    console.error(`[prune] ошибка: ${err.message}`);
  }
}

// Healthcheck для платформы хостинга.
const server = http.createServer((req, res) => {
  const url = (req.url ?? "").split("?")[0];
  if (url === "/health" || url === "/") {
    const status = feeds.map((f) => ({ feed: `${f.exchange}:${f.symbol}`, synced: f.book.synced, ...f.book.stats }));
    const healthy = feeds.some((f) => f.book.synced);
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ healthy, feeds: status }));
  } else if (url === "/metrics") {
    // Защищённый эндпоинт для админ-панели Next.js (раздел «Карта ордеров»).
    // Bearer-токен COLLECTOR_METRICS_TOKEN. Если токен не задан — 404 (закрыто).
    const auth = req.headers["authorization"] ?? "";
    if (!cfg.metricsToken || auth !== `Bearer ${cfg.metricsToken}`) {
      res.writeHead(cfg.metricsToken ? 401 : 404);
      res.end();
      return;
    }
    const now = Date.now();
    const feedMetrics = feeds.map((f) => {
      const tag = `${f.exchange}:${f.symbol}`;
      const m = metricFor(tag);
      const lastWriteAgoMs = m.lastWriteAt ? now - Date.parse(m.lastWriteAt) : null;
      return {
        feed: tag,
        exchange: f.exchange,
        symbol: f.symbol,
        synced: f.book.synced,
        binSize: f.binSize,
        ...f.book.stats, // resyncCount, appliedCount, bidLevels, askLevels
        obRows: m.obRows,
        obLastBins: m.obLastBins,
        deltaRows: m.deltaRows,
        fpRows: m.fpRows,
        bigRows: m.bigRows,
        lastWriteAt: m.lastWriteAt,
        lastWriteAgoMs,
      };
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      healthy: feeds.some((f) => f.book.synced),
      uptimeMs: now - startedAt,
      snapshotMs: cfg.snapshotMs,
      depthPct: cfg.depthPct,
      retentionDays: cfg.retentionDays,
      noiseMinNotional: cfg.noiseMinNotional,
      bigNotional: cfg.bigNotional,
      feeds: feedMetrics,
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(cfg.port, () => console.log(`[health] http://0.0.0.0:${cfg.port}/health`));

console.log(
  `[start] collector feeds=${feeds.length} (${feeds.map((f) => `${f.exchange}:${f.symbol}`).join(", ")}) ` +
    `bin=$${cfg.binSize} snapshot=${cfg.snapshotMs}ms depth=±${cfg.depthPct * 100}% retention=${cfg.retentionDays}d`,
);
for (const f of feeds) f.book.connect();
for (const tf of tradeFeeds) tf.trades.connect();

// Одноразовый бэкафилл rollup из сырой истории ObSnapshot — чтобы при первом
// запуске новой версии heatmap сразу показывал всю историю (а не только минуты
// после рестарта). Выполняется только если rollup пуст; INSERT…SELECT целиком в
// Postgres (без переноса строк в Node). mid для исторических бакетов оцениваем
// как VWAP бакета (живые данные пишут точный mid).
async function backfillRollup() {
  try {
    const exists = await pool.query(`SELECT 1 FROM "ObSnapshotRollup" LIMIT 1`);
    if (exists.rowCount > 0) return;
    console.log("[rollup] бэкафилл из ObSnapshot…");
    await pool.query(`
      INSERT INTO "ObSnapshotRollup" ("symbol","exchange","bucket","price","volSum","bidSum","askSum")
      SELECT "symbol","exchange",
             to_timestamp(floor(extract(epoch from "t") / 60) * 60),
             "price", SUM("bidVol" + "askVol"), SUM("bidVol"), SUM("askVol")
      FROM "ObSnapshot"
      GROUP BY "symbol","exchange", to_timestamp(floor(extract(epoch from "t") / 60) * 60), "price"
      ON CONFLICT DO NOTHING
    `);
    await pool.query(`
      INSERT INTO "ObRollupBucket" ("symbol","exchange","bucket","snaps","midSum")
      SELECT "symbol","exchange",
             to_timestamp(floor(extract(epoch from "t") / 60) * 60),
             COUNT(DISTINCT "t"),
             COUNT(DISTINCT "t") * (SUM("price" * ("bidVol" + "askVol")) / NULLIF(SUM("bidVol" + "askVol"), 0))
      FROM "ObSnapshot"
      GROUP BY "symbol","exchange", to_timestamp(floor(extract(epoch from "t") / 60) * 60)
      ON CONFLICT DO NOTHING
    `);
    console.log("[rollup] бэкафилл завершён");
  } catch (err) {
    console.error(`[rollup] бэкафилл ошибка: ${err.message}`);
  }
}
setTimeout(backfillRollup, 5_000);

const writeTimer = setInterval(writeSnapshot, cfg.snapshotMs);
const pruneTimer = setInterval(pruneOld, 3600_000);
setTimeout(pruneOld, 10_000);

async function shutdown() {
  clearInterval(writeTimer);
  clearInterval(pruneTimer);
  for (const f of feeds) f.book.close();
  for (const tf of tradeFeeds) tf.trades.close();
  server.close();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (RUN_MS > 0) setTimeout(shutdown, RUN_MS);
