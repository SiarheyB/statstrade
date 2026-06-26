// Collector-сервис: для каждой пары (биржа × символ) поддерживает локальный
// стакан, раз в SNAPSHOT_MS бинует уровни по цене в пределах ±DEPTH_PCT от mid,
// фильтрует шум и пишет агрегаты в Postgres (таблица ObSnapshot). Периодически
// чистит данные старше RETENTION_DAYS. Поднимает HTTP healthcheck на PORT.
//
// Запуск:  node collector/index.mjs   (нужен DATABASE_URL)
// Конфиг через ENV — см. .env.example.

import http from "node:http";
import pg from "pg";
import { createOrderBook } from "./orderbook.mjs"; // binance futures
import { createBybitBook } from "./bybit.mjs";
import { createOkxBook } from "./okx.mjs";
import { createBinanceTrades } from "./trades.mjs";

const cfg = {
  symbols: (process.env.SYMBOLS ?? "BTCUSDT").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean),
  exchanges: (process.env.EXCHANGES ?? "binance-futures").split(",").map((s) => s.trim()).filter(Boolean),
  binSize: Number(process.env.BIN_SIZE ?? 25),
  snapshotMs: Number(process.env.SNAPSHOT_MS ?? 2000),
  depthPct: Number(process.env.DEPTH_PCT ?? 0.02),
  retentionDays: Number(process.env.RETENTION_DAYS ?? 7),
  noiseMinNotional: Number(process.env.NOISE_MIN_NOTIONAL ?? 50000),
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT ?? 8080),
};

if (!cfg.databaseUrl) {
  console.error("[fatal] DATABASE_URL не задан");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 4 });
const RUN_MS = Number(process.env.RUN_MS ?? 0);

// Шаг бина может зависеть от символа (BTC ~$25, ETH ~$1 и т.д.). Базовый —
// cfg.binSize для BTC; для прочих масштабируем по цене (можно переопределить
// через BIN_SIZE_<SYMBOL>).
function binSizeFor(symbol) {
  const env = process.env[`BIN_SIZE_${symbol}`];
  if (env) return Number(env);
  return cfg.binSize;
}

const FACTORY = {
  "binance-futures": (symbol, h) => createOrderBook({ symbol, onResync: h.onResync, onError: h.onError }),
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

// Лента сделок для дельты — по одному потоку Binance на каждый символ.
const tradeFeeds = cfg.symbols.map((symbol) => ({
  symbol,
  exchange: "binance-futures",
  trades: createBinanceTrades({ symbol, onError: (e) => console.error(`[trades] ${symbol} ${e.message}`) }),
}));

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

function rowsForFeed(feed, t) {
  const { book, binSize } = feed;
  if (!book.synced) return [];
  const bb = book.bestBid();
  const ba = book.bestAsk();
  if (!bb || !ba) return [];
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
  return out;
}

async function writeSnapshot() {
  const t = new Date();
  const rows = [];
  for (const feed of feeds) rows.push(...rowsForFeed(feed, t));

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

  // Дельта: слить накопленные сделки в ObTrade.
  const tRows = [];
  for (const tf of tradeFeeds) {
    const { buyVol, sellVol } = tf.trades.drain();
    if (buyVol === 0 && sellVol === 0) continue;
    tRows.push([tf.symbol, tf.exchange, t, buyVol, sellVol]);
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

  const synced = feeds.filter((f) => f.book.synced).length;
  console.log(`[write] t=${t.toISOString()} ob=${rows.length} delta=${tRows.length} feeds=${synced}/${feeds.length}`);
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
    const n = (r1.rowCount ?? 0) + (r2.rowCount ?? 0);
    if (n) console.log(`[prune] удалено ${n} старых строк`);
  } catch (err) {
    console.error(`[prune] ошибка: ${err.message}`);
  }
}

// Healthcheck для платформы хостинга.
const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    const status = feeds.map((f) => ({ feed: `${f.exchange}:${f.symbol}`, synced: f.book.synced, ...f.book.stats }));
    const healthy = feeds.some((f) => f.book.synced);
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ healthy, feeds: status }));
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
