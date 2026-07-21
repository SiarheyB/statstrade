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
  retentionDays: Number(process.env.RETENTION_DAYS ?? 7),         // сырые снапшоты ObSnapshot
  tradeRetentionDays: Number(process.env.TRADE_RETENTION_DAYS ?? process.env.RETENTION_DAYS ?? 30), // сделки/футпринт/крупные
  rawRetention: Number(process.env.RAW_RETENTION_DAYS ?? 30),     // сырые данные хранить 30 дней
  rollupRetention: Number(process.env.ROLLUP_RETENTION_DAYS ?? 365), // агрегаты хранить 365 дней
  candleRetentionDays: Number(process.env.CANDLE_RETENTION_DAYS ?? 365), // свечи (ObCandle) хранить 365 дней
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

// === Свечи (OHLCV) ===
// Таймфреймы свечей, которые собираем. Совпадает с TF_MS в API-роуте orderflow.
const CANDLE_INTERVALS = ["5m", "15m", "1h", "4h", "12h", "1d", "1w"];
const CANDLE_MS = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

// Binance API base URL по бирже (только Binance пока).
function klinesUrl(exchange) {
  if (exchange === "binance-futures") return "https://fapi.binance.com/fapi/v1/klines";
  if (exchange === "binance-spot") return "https://api.binance.com/api/v3/klines";
  return null;
}

// Запрашивает и сохраняет свечи одной пары (symbol × exchange × interval).
// Узнаёт последнюю сохранённую свечу и тянет от неё (или с начала ретеншна).
async function fetchAndStoreCandlesFor(symbol, exchange, interval) {
  const urlBase = klinesUrl(exchange);
  if (!urlBase) return; // неподдерживаемая биржа — пропускаем

  // Последняя свеча в БД
  const last = await pool.query(
    `SELECT MAX("t") as ts FROM "ObCandle" WHERE "symbol"=$1 AND "exchange"=$2 AND "interval"=$3`,
    [symbol, exchange, interval],
  );
  const lastTs = last.rows[0]?.ts ? new Date(last.rows[0].ts).getTime() : 0;
  const now = Date.now();
  const startMs = lastTs > 0 ? lastTs : now - cfg.candleRetentionDays * 86_400_000;

  // Не запрашиваем, если последняя свеча моложе интервала (ещё не завершилась)
  const intervalMs = CANDLE_MS[interval] ?? 3600_000;
  if (lastTs > 0 && now - lastTs < intervalMs) return;

  // Binance limit = 1500 свечей. Если окно шире — тянем последовательно.
  let fromMs = startMs;
  let total = 0;
  while (fromMs < now) {
    const toMs = Math.min(fromMs + intervalMs * 1500, now);
    const url = `${urlBase}?symbol=${symbol}&interval=${interval}&startTime=${fromMs}&endTime=${toMs}&limit=1500`;
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      console.error(`[candles] fetch error ${exchange}:${symbol} ${interval}: ${err.message}`);
      break;
    }
    if (!res.ok) {
      console.error(`[candles] HTTP ${res.status} ${exchange}:${symbol} ${interval}`);
      break;
    }
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) break;

    // Batched upsert
    const values = [];
    const params = [];
    for (let i = 0; i < raw.length; i++) {
      const k = raw[i];
      const b = params.length;
      values.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9})`);
      params.push(symbol, exchange, interval, new Date(Number(k[0])), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5]));
    }
    try {
      await pool.query(`
        INSERT INTO "ObCandle" ("symbol","exchange","interval","t","o","h","l","c","v")
        VALUES ${values.join(",")}
        ON CONFLICT ("symbol","exchange","interval","t") DO NOTHING
      `, params);
    } catch (err) {
      console.error(`[candles] upsert error ${exchange}:${symbol} ${interval}: ${err.message}`);
      break;
    }
    total += raw.length;
    // Двигаем fromMs на последний timestamp полученной свечи
    fromMs = Number(raw[raw.length - 1][0]) + 1;
    if (fromMs >= now) break;
  }
  if (total > 0) {
    console.log(`[candles] ${exchange}:${symbol} ${interval}: +${total} свечей`);
  }
}

// Все биржи, для которых коллектор умеет собирать свечи (OHLCV).
// Не зависит от cfg.exchanges — свечи собираются для spot и futures,
// чтобы при переключении между биржами в UI свечи не пропадали.
const CANDLE_EXCHANGES = ["binance-futures", "binance-spot"];

async function fetchAndStoreCandles() {
  const seen = new Set();
  for (const exchange of CANDLE_EXCHANGES) {
    for (const symbol of cfg.symbols) {
      for (const interval of CANDLE_INTERVALS) {
        const key = `${exchange}|${symbol}|${interval}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await fetchAndStoreCandlesFor(symbol, exchange, interval);
      }
    }
  }
}

// Заполняет свечи из истории, если таблица пуста. Если таблицу уже наполнил
// API-роут (on-demand fetch), пропускает — обычный цикл fetchAndStoreCandles
// дозаполнит недостающие символы/биржи/интервалы.
async function backfillCandles() {
  try {
    const exists = await pool.query(`SELECT 1 FROM "ObCandle" LIMIT 1`);
    if (exists.rowCount > 0) return;
    console.log("[candles] бэкафилл из Binance…");
    await fetchAndStoreCandles();
    console.log("[candles] бэкафилл завершён");
  } catch (err) {
    console.error(`[candles] бэкафилл ошибка: ${err.message}`);
  }
}

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

// Порог «только крупные лимитки» в монетах базового актива, по символу. Читается
// из таблицы CollectorConfig (редактируется в админ-панели) и обновляется каждые
// ~30с — без редеплоя. Фолбэк — встроенные дефолты; для символов, у которых
// порога нет, действует прежний шумовой фильтр по нотионалу ($).
// Пороги раздельные по рынку: ключ — `${SYMBOL}|${market}` (spot | futures).
// Рынок фида выводится из имени биржи: "*-futures" → futures, иначе spot.
const DEFAULT_MIN_COINS = {
  "BTCUSDT|spot": 500, "BTCUSDT|futures": 500,
  "ETHUSDT|spot": 5000, "ETHUSDT|futures": 5000,
};
const marketOf = (exchange) => (String(exchange).endsWith("-futures") ? "futures" : "spot");
let minCoinsMap = new Map(Object.entries(DEFAULT_MIN_COINS));
// Возвращает: "all" (писать все уровни без фильтров) | число (порог в монетах)
// | null (порога нет → шумовой фильтр по нотионалу).
function minCoinsFor(symbol, exchange) {
  const v = minCoinsMap.get(`${symbol}|${marketOf(exchange)}`);
  if (v === "all") return "all";
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
async function loadCollectorConfig() {
  try {
    const r = await pool.query(`SELECT "symbol", "market", "minCoins", "collectAll" FROM "CollectorConfig"`);
    const m = new Map(Object.entries(DEFAULT_MIN_COINS));
    for (const row of r.rows) {
      const key = `${String(row.symbol).toUpperCase()}|${row.market === "futures" ? "futures" : "spot"}`;
      m.set(key, row.collectAll ? "all" : Number(row.minCoins));
    }
    minCoinsMap = m;
  } catch (err) {
    console.error(`[config] загрузка CollectorConfig: ${err.message}`);
  }
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
    const totalCoins = bidVol + askVol;
    // «Только крупные лимитки»: для символов с порогом в монетах фильтруем по нему
    // (напр. ≥500 BTC), порог свой на рынок (spot/futures); "all" — писать все
    // уровни без фильтров; иначе — прежний фильтр шума по нотионалу ($).
    const minCoins = minCoinsFor(feed.symbol, feed.exchange);
    if (minCoins !== "all") {
      if (minCoins != null ? totalCoins < minCoins : totalCoins * c < cfg.noiseMinNotional) continue;
    }
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

// Асинхронный «beat» для flush rollup — не блокирует запись снапшотов
function startRollupFlushBeat() {
  // Каждые 1000 мс сбрасываем завершённые минутные бакеты
  // На 4 ядрах один beat-поток достаточен; избегаем лишних воркеров
  return setInterval(() => {
    flushRollup(new Date()).catch(err => console.error(`[rollup-beat] ошибка: ${err.message}`));
  }, 1000);
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

// Обслуживание дневных партиций (таблицы Ob* партиционированы по t, см.
// миграцию partition_ob_tables): создаём партиции на неделю вперёд и чистим
// ретеншн всех таблиц.
//   - ObSnapshot        — сырые снапшоты, чистим по RETENTION_DAYS (умолч. 7 дн)
//   - ObTrade / ObFootprint / ObBigTrade — сделки, футпринт, крупные ордера,
//     чистим по TRADE_RETENTION_DAYS (умолч. 30 дн, либо RETENTION_DAYS если задан)
// Чистка = мгновенный DROP партиции вместо DELETE (ноль bloat'а на SSD).
// Rollup (ObSnapshotRollup, ObRollupBucket) — не партиционированы, чистятся
// DELETE из админ-панели (см. /api/admin/collector/purge).
const PARTITIONED_TABLES = ["ObSnapshot", "ObTrade", "ObFootprint", "ObBigTrade"];
async function pruneOld() {
  try {
    for (const tbl of PARTITIONED_TABLES) {
      await pool.query(`SELECT ob_ensure_partitions($1, 7)`, [tbl]);
    }
    let total = 0;
    // Snapshot-таблица — отдельный ретеншн (короткий, данные тяжёлые)
    {
      const r = await pool.query(
        `SELECT ob_drop_partitions_before($1, NOW() - ($2 || ' days')::interval) AS n`,
        ["ObSnapshot", String(cfg.rawRetention)],
      );
      total += r.rows[0]?.n ?? 0;
    }
    // Сделки, футпринт, крупные ордера — другой ретеншн (дольше, легковеснее)
    {
      const r = await pool.query(
        `SELECT ob_drop_partitions_before($1, NOW() - ($2 || ' days')::interval) AS n`,
        ["ObTrade", String(cfg.tradeRetentionDays)],
      );
      total += r.rows[0]?.n ?? 0;
    }
    {
      const r = await pool.query(
        `SELECT ob_drop_partitions_before($1, NOW() - ($2 || ' days')::interval) AS n`,
        ["ObFootprint", String(cfg.tradeRetentionDays)],
      );
      total += r.rows[0]?.n ?? 0;
    }
    {
      const r = await pool.query(
        `SELECT ob_drop_partitions_before($1, NOW() - ($2 || ' days')::interval) AS n`,
        ["ObBigTrade", String(cfg.tradeRetentionDays)],
      );
      total += r.rows[0]?.n ?? 0;
    }
    // Rollup‑таблицы — НЕ партиционированы, чистим DELETE‑ом по ROLLUP_RETENTION_DAYS
    let rollupDeleted = 0;
    {
      const r = await pool.query(
        `DELETE FROM "ObSnapshotRollup" WHERE bucket < NOW() - ($1 || ' days')::interval`,
        [String(cfg.rollupRetention)],
      );
      rollupDeleted += r.rowCount ?? 0;
    }
    {
      const r = await pool.query(
        `DELETE FROM "ObRollupBucket" WHERE bucket < NOW() - ($1 || ' days')::interval`,
        [String(cfg.rollupRetention)],
      );
      rollupDeleted += r.rowCount ?? 0;
    }
    // Свечи (ObCandle) — не партиционированы, чистим DELETE-ом по CANDLE_RETENTION_DAYS
    let candlesDeleted = 0;
    {
      const r = await pool.query(
        `DELETE FROM "ObCandle" WHERE "t" < NOW() - ($1 || ' days')::interval`,
        [String(cfg.candleRetentionDays)],
      );
      candlesDeleted = r.rowCount ?? 0;
    }
    if (total || rollupDeleted || candlesDeleted) {
      console.log(
        `[prune] сброшено ${total} партиций (снапшоты: ${cfg.rawRetention}д, сделки: ${cfg.tradeRetentionDays}д); ` +
        `удалено ${rollupDeleted} строк rollup (retention: ${cfg.rollupRetention}д); ` +
        `удалено ${candlesDeleted} свечей (retention: ${cfg.candleRetentionDays}д)`,
      );
    }
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
      tradeRetentionDays: cfg.tradeRetentionDays,
      candleRetentionDays: cfg.candleRetentionDays,
      noiseMinNotional: cfg.noiseMinNotional,
      bigNotional: cfg.bigNotional,
      minCoins: Object.fromEntries(minCoinsMap),
      feeds: feedMetrics,
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(cfg.port, () => console.log(`[health] http://0.0.0.0:${cfg.port}/health`));

// Запуск коллектора — только если файл исполняется напрямую (node index.mjs),
// а не импортируется в юнит-тесты. Проверка: import.meta.url совпадает с
// process.argv[1] (исполняемый файл).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

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

if (isMain) {
console.log(
  `[start] collector feeds=${feeds.length} (${feeds.map((f) => `${f.exchange}:${f.symbol}`).join(", ")}) ` +
    `bin=$${cfg.binSize} snapshot=${cfg.snapshotMs}ms depth=±${cfg.depthPct * 100}% ` +
    `retention: snap=${cfg.retentionDays}d trades=${cfg.tradeRetentionDays}d candles=${cfg.candleRetentionDays}d`,
);
for (const f of feeds) f.book.connect();
for (const tf of tradeFeeds) tf.trades.connect();

setTimeout(backfillRollup, 5_000);

// Пороги «крупных лимиток» — читаем сразу и обновляем каждые 30с (правки из админки).
loadCollectorConfig();
const configTimer = setInterval(loadCollectorConfig, 30_000);

const writeTimer = setInterval(writeSnapshot, cfg.snapshotMs);
const flushTimer = startRollupFlushBeat();
const pruneTimer = setInterval(pruneOld, 3600_000);
setTimeout(pruneOld, 10_000);

// Свечи — раз в 60 секунд, первый запуск через 15с (после бэкафилла)
const candleTimer = setInterval(fetchAndStoreCandles, 60_000);
setTimeout(fetchAndStoreCandles, 15_000);
setTimeout(backfillCandles, 30_000);

async function shutdown() {
  clearInterval(writeTimer);
  clearInterval(flushTimer);
  clearInterval(pruneTimer);
  clearInterval(configTimer);
  clearInterval(candleTimer);
  for (const f of feeds) f.book.close();
  for (const tf of tradeFeeds) tf.trades.close();
  server.close();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (RUN_MS > 0) setTimeout(shutdown, RUN_MS);
} // end isMain

// Экспорты для юнит-тестов (не влияют на работу скрипта)
export { binSide, rowsForFeed, accumulateRollup, flushRollup, writeSnapshot, pruneOld, loadCollectorConfig, backfillRollup, fetchAndStoreCandles, backfillCandles };
export { FACTORY, DEFAULT_BIN, DEFAULT_MIN_COINS, marketOf, minCoinsFor };
