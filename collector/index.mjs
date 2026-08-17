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
  // retentionDays (RETENTION_DAYS / OB_RETENTION_DAYS в docker-compose) —
  // реальный и единственный порог очистки ObSnapshot. Раньше в pruneOld()
  // использовалась отдельная rawRetention (RAW_RETENTION_DAYS), которой нет
  // ни в docker-compose.prod.yml, ни в .env на проде — она всегда падала на
  // хардкод 30 дней и полностью игнорировала настроенные здесь дни. Убрано.
  retentionDays: Number(process.env.RETENTION_DAYS ?? 7),         // сырые снапшоты ObSnapshot
  tradeRetentionDays: Number(process.env.TRADE_RETENTION_DAYS ?? process.env.RETENTION_DAYS ?? 30), // сделки/футпринт/крупные
  // Агрегаты карты ордеров (Ob*Rollup) — это ВСЯ история лимиток: сырьё живёт
  // недели, а картинку на любом горизонте рисуют именно они. Поэтому по
  // умолчанию не чистим их вовсе (0 = хранить вечно). Прежний дефолт 365
  // молча удалял бы историю по достижении года.
  rollupRetention: Number(process.env.ROLLUP_RETENTION_DAYS ?? 0), // 0 = хранить вечно
  candleRetentionDays: Number(process.env.CANDLE_RETENTION_DAYS ?? 365), // свечи (ObCandle) хранить 365 дней
  // Полный скан дневных свечей по всем USDT-парам Binance spot (фича
  // "Рекомендации", см. TRADE_RECOMMENDATIONS_PLAN.md). Выключено по
  // умолчанию — включается явно, чтобы не менять поведение существующих
  // деплоев без ведома.
  scanAllUsdtPairs: (process.env.SCAN_ALL_USDT_PAIRS ?? "false") === "true",
  allPairsScanIntervalMs: Number(process.env.ALL_PAIRS_SCAN_INTERVAL_MS ?? 24 * 3600_000),
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

// Комбинации symbol×exchange×interval, для которых уже подтверждено, что
// история упирается в реальное начало торгов на бирже (Binance вернул данные
// позже запрошенного startTime) — глубже физически ничего нет, сколько бы
// CANDLE_RETENTION_DAYS ни было задано. Без этой отметки проверка глубины
// ниже (oldestTs vs retentionStart) никогда не проходит для старых пар с
// коротким реальным листингом (BTCUSDT торгуется с 2017/2019, а не с
// начала retentionStart) — коллектор бы каждые 60с перезапускал бэкафилл
// заново вместо перехода в режим "только новые свечи". Сбрасывается при
// рестарте контейнера — тогда одна проверка повторится, это нормально.
const candleDepthReached = new Set();

// Запрашивает и сохраняет свечи одной пары (symbol × exchange × interval).
// Узнаёт последнюю сохранённую свечу и тянет от неё (или с начала ретеншна).
async function fetchAndStoreCandlesFor(symbol, exchange, interval) {
  const urlBase = klinesUrl(exchange);
  if (!urlBase) return; // неподдерживаемая биржа — пропускаем

  const now = Date.now();
  const retentionStart = now - cfg.candleRetentionDays * 86_400_000;
  const intervalMs = CANDLE_MS[interval] ?? 3600_000;

  // Последняя свеча в БД
  const last = await pool.query(
    `SELECT MAX("t") as ts FROM "ObCandle" WHERE "symbol"=$1 AND "exchange"=$2 AND "interval"=$3`,
    [symbol, exchange, interval],
  );
  const lastTs = last.rows[0]?.ts ? new Date(last.rows[0].ts).getTime() : 0;
  const depthKey = `${exchange}|${symbol}|${interval}`;

  // Если таблица не пуста — проверяем, достаточно ли глубоко уходит история.
  // Если самая старая свеча новее, чем retentionStart + 1 час — значит,
  // исторических данных не хватает, и нужно начать заполнение с границы
  // ретеншна, а не от последней свечи. ON CONFLICT DO UPDATE ниже
  // обновит h/l/c/v существующих свечей, так что формирующаяся свеча
  // получит актуальные данные. Исключение — candleDepthReached: если уже
  // подтверждено, что глубже реальных данных на бирже нет, не гоняем
  // полный бэкафилл заново на каждом цикле.
  let startMs;
  if (lastTs > 0) {
    if (candleDepthReached.has(depthKey)) {
      startMs = lastTs; // нормальный режим: только новые свечи
    } else {
      const oldest = await pool.query(
        `SELECT MIN("t") as ts FROM "ObCandle" WHERE "symbol"=$1 AND "exchange"=$2 AND "interval"=$3`,
        [symbol, exchange, interval],
      );
      const oldestTs = oldest.rows[0]?.ts ? new Date(oldest.rows[0].ts).getTime() : 0;
      if (oldestTs > retentionStart + 3600_000) {
        startMs = retentionStart; // не хватает истории — начинаем с границы ретеншна
      } else {
        startMs = lastTs; // нормальный режим: только новые свечи
      }
    }
  } else {
    startMs = retentionStart; // таблица пуста — заполняем с границы ретеншна
  }

  // Не запрашиваем, только если последняя свеча моложе 30 секунд (данные
  // всё равно не успели измениться). Для формирующейся свечи (1–4 мин)
  // запрашиваем, чтобы обновить h/l/c/v через ON CONFLICT DO UPDATE.
  if (lastTs > 0 && now - lastTs < 30_000 && startMs === lastTs) return;

  // Binance limit = 1500 свечей. Если окно шире — тянем последовательно.
  //
  // endTime всегда = now (а не fromMs + intervalMs*1500!) — иначе при глубоком
  // CANDLE_RETENTION_DAYS и узком таймфрейме (5m/15m/...) первый запрос
  // попадает в окно, целиком лежащее РАНЬШЕ даты листинга символа на бирже
  // (например, retentionStart ~2012 год для BTCUSDT, который торгуется с
  // 2017/2019) — Binance корректно отвечает пустым массивом just для этого
  // узкого отрезка, а не "истории вообще нет". limit=1500 и так ограничивает
  // объём ответа, поэтому сужать endTime не нужно: с endTime=now пустой ответ
  // означает "данных дальше действительно нет", а не "не туда заглянули".
  // Для широких интервалов (1w — окно ~28 лет) это ничего не меняло, там
  // toMs и так почти всегда совпадал с now.
  let fromMs = startMs;
  let total = 0;
  while (fromMs < now) {
    const url = `${urlBase}?symbol=${symbol}&interval=${interval}&startTime=${fromMs}&endTime=${now}&limit=1500`;
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

    // Первый чанк этого прохода начинался с startMs=retentionStart (глубокий
    // бэкафилл) — если биржа вернула данные ощутимо позже запрошенного, значит
    // раньше этой даты у неё физически ничего нет (символ ещё не торговался).
    // Запоминаем — не будем каждый цикл заново ломиться в ту же стену.
    if (fromMs === startMs && startMs !== lastTs) {
      const firstT = Number(raw[0][0]);
      if (firstT > startMs + intervalMs) {
        candleDepthReached.add(depthKey);
      }
    }

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
        ON CONFLICT ("symbol","exchange","interval","t") DO UPDATE SET
          "h" = EXCLUDED."h",
          "l" = EXCLUDED."l",
          "c" = EXCLUDED."c",
          "v" = EXCLUDED."v"
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

// При глубоком CANDLE_RETENTION_DAYS (годы истории) один проход по всем
// symbol×exchange×interval может занимать дольше 60с (интервал candleTimer
// ниже) — без этого флага setInterval запускал бы новый проход поверх ещё
// идущего, и оба одновременно долбили бы Binance по тем же символам.
let candlesRunning = false;

async function fetchAndStoreCandles() {
  if (candlesRunning) return;
  candlesRunning = true;
  try {
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
  } finally {
    candlesRunning = false;
  }
}

// Заполняет свечи из истории, если в таблице не хватает исторических данных.
// Проверяет самую старую свечу: если она новее, чем retentionStart + 1 час —
// запускает полное заполнение. Сама `fetchAndStoreCandlesFor` тоже проверяет
// глубину истории при каждом запуске, но здесь мы форсируем полный цикл
// сразу при старте, чтобы не ждать 70+ итераций по 60 секунд.
async function backfillCandles() {
  try {
    const oldest = await pool.query(`SELECT MIN("t") as ts FROM "ObCandle"`);
    const oldestTs = oldest.rows[0]?.ts ? new Date(oldest.rows[0].ts).getTime() : 0;
    const retentionStart = Date.now() - cfg.candleRetentionDays * 86_400_000;
    // Если самая старая свеча достаточно старая (в пределах 1 часа от границы
    // ретеншна) — бэкафилл не нужен, обычный цикл дозаполнит.
    if (oldestTs > 0 && oldestTs <= retentionStart + 3600_000) return;
    console.log("[candles] бэкафилл из Binance…");
    await fetchAndStoreCandles();
    console.log("[candles] бэкафилл завершён");
  } catch (err) {
    console.error(`[candles] бэкафилл ошибка: ${err.message}`);
  }
}

// === Полный скан дневных свечей по всем USDT-M бессрочным фьючерсам Binance ===
// Отдельный, гораздо более широкий скан, чем cfg.symbols/CANDLE_INTERVALS
// выше — нужен для фичи "Рекомендации" (поиск дневных уровней/сетапов
// пробой/ложный пробой по всем инструментам, см. TRADE_RECOMMENDATIONS_PLAN.md),
// а не только по паре-двум, для которых собирается стакан. Именно фьючерсы,
// не спот — торгуем и в лонг, и в шорт, спот для этого не нужен. Тянет ТОЛЬКО
// "1d" (свечи для уровней, не для интерактивного графика) — вес запроса
// минимальный (limit<=1500 → ~2 веса), поэтому даже 300+ пар не создают
// ощутимой нагрузки на Binance API за один проход.
const ALL_PAIRS_EXCHANGE = "binance-futures";
let allPairsScanRunning = false;

// Бессрочные контракты, которые нас интересуют:
//  - PERPETUAL          — обычные крипто-бессрочные (BTCUSDT, ETHUSDT, ...);
//  - TRADIFI_PERPETUAL  — бессрочные на традиционные активы (XAUUSDT — золото,
//                         TSLAUSDT/AMZNUSDT/COINUSDT — акции). Методичка, по
//                         которой ищем уровни, разбирает примеры как раз на
//                         акциях и металлах (AMZN, XOM, NVDA, MSFT), так что
//                         исключать их нет причин.
// Квартальные/поставочные (CURRENT_QUARTER, NEXT_QUARTER) не берём — они
// истекают. Статусы SETTLING (контракт доживает до расчёта) и PENDING_TRADING
// (торги ещё не начались) тоже отсекаются — свечей "на сегодня" там нет.
const WANTED_CONTRACT_TYPES = new Set(["PERPETUAL", "TRADIFI_PERPETUAL"]);

/**
 * Актуальный список пар с биржи. Кэша НЕТ намеренно: скан идёт раз в сутки
 * (или по кнопке в админке), и один лишний запрос к exchangeInfo ничего не
 * стоит, зато список всегда свежий — новые листинги попадают в выдачу сразу,
 * а не через полсуток.
 */
async function fetchUsdtFuturesSymbols() {
  const res = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo");
  if (!res.ok) throw new Error(`exchangeInfo HTTP ${res.status}`);
  const data = await res.json();
  const all = data.symbols ?? [];
  const tradable = all.filter(
    (s) => s.status === "TRADING" && s.quoteAsset === "USDT" && WANTED_CONTRACT_TYPES.has(s.contractType),
  );
  const crypto = tradable.filter((s) => s.contractType === "PERPETUAL").length;
  console.log(
    `[recommendations] exchangeInfo: ${all.length} символов, берём ${tradable.length} ` +
      `(крипто ${crypto} + tradfi ${tradable.length - crypto})`,
  );
  return tradable.map((s) => s.symbol);
}

// Раз в сутки: список USDT-M пар + дневные свечи по каждой. Последовательно с
// небольшой паузой между запросами — вежливо к rate-limit Binance, спешить
// некуда (свечи дневные, чаще обновлять их бессмысленно).
// Прогресс скана — его читает приложение через GET /scan-daily, чтобы
// показать в админке этап «Загружаем свечи с Binance» до пересчёта уровней.
const allPairsScanState = {
  running: false,
  done: 0,
  total: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

async function scanAllUsdtPairsDaily() {
  if (allPairsScanRunning) return;
  allPairsScanRunning = true;
  allPairsScanState.running = true;
  allPairsScanState.done = 0;
  allPairsScanState.total = 0;
  allPairsScanState.startedAt = new Date().toISOString();
  allPairsScanState.finishedAt = null;
  allPairsScanState.error = null;
  try {
    const symbols = await fetchUsdtFuturesSymbols();
    allPairsScanState.total = symbols.length;
    console.log(`[recommendations] скан дневных свечей: ${symbols.length} USDT-M фьючерсов`);
    let done = 0;
    for (const symbol of symbols) {
      try {
        await fetchAndStoreCandlesFor(symbol, ALL_PAIRS_EXCHANGE, "1d");
      } catch (err) {
        console.error(`[recommendations] ${symbol} 1d: ${err.message}`);
      }
      done++;
      allPairsScanState.done = done;
      await new Promise((r) => setTimeout(r, 150));
    }
    console.log(`[recommendations] скан завершён: ${done}/${symbols.length} пар`);
  } catch (err) {
    allPairsScanState.error = err.message;
    console.error(`[recommendations] скан ошибка: ${err.message}`);
  } finally {
    allPairsScanRunning = false;
    allPairsScanState.running = false;
    allPairsScanState.finishedAt = new Date().toISOString();
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

// То же для ленты сделок (ObTradeRollup): дельта/CVD и «скорость ленты»
// читают минутные суммы вместо сырого ObTrade.
const tradeRollup = new Map(); // key -> { symbol, exchange, bucketMs, buyVol, sellVol, trades }

function accumulateTradeRollup(symbol, exchange, t, buyVol, sellVol, count) {
  const bucketMs = Math.floor(t.getTime() / 60_000) * 60_000;
  const key = `${symbol}|${exchange}|${bucketMs}`;
  let e = tradeRollup.get(key);
  if (!e) {
    e = { symbol, exchange, bucketMs, buyVol: 0, sellVol: 0, trades: 0 };
    tradeRollup.set(key, e);
  }
  e.buyVol += buyVol;
  e.sellVol += sellVol;
  e.trades += count;
}

// Rollup футпринта: 5-минутные бакеты × ценовой уровень. Пять минут — младший
// таймфрейм графика, остальные кратны ему, поэтому собираются точно.
const FP_BUCKET_MS = 300_000;
const fpRollup = new Map(); // key -> { symbol, exchange, bucketMs, prices: Map<price,{buy,sell}> }

function accumulateFootprintRollup(symbol, exchange, t, levels) {
  if (levels.length === 0) return;
  const bucketMs = Math.floor(t.getTime() / FP_BUCKET_MS) * FP_BUCKET_MS;
  const key = `${symbol}|${exchange}|${bucketMs}`;
  let e = fpRollup.get(key);
  if (!e) {
    e = { symbol, exchange, bucketMs, prices: new Map() };
    fpRollup.set(key, e);
  }
  for (const lvl of levels) {
    if (lvl.buy === 0 && lvl.sell === 0) continue;
    const cell = e.prices.get(lvl.price) ?? { buy: 0, sell: 0 };
    cell.buy += lvl.buy;
    cell.sell += lvl.sell;
    e.prices.set(lvl.price, cell);
  }
}

async function flushFootprintRollup(now) {
  const curBucket = Math.floor(now.getTime() / FP_BUCKET_MS) * FP_BUCKET_MS;
  for (const [key, e] of fpRollup) {
    if (e.bucketMs >= curBucket) continue;
    fpRollup.delete(key);
    if (e.prices.size === 0) continue;
    const bucket = new Date(e.bucketMs);
    try {
      const values = [];
      const params = [];
      let i = 0;
      for (const [price, cell] of e.prices) {
        const b = i * 6;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
        params.push(e.symbol, e.exchange, bucket, price, cell.buy, cell.sell);
        i += 1;
      }
      await pool.query(
        `INSERT INTO "ObFootprintRollup" ("symbol","exchange","bucket","price","buyVol","sellVol")
         VALUES ${values.join(",")}
         ON CONFLICT ("symbol","exchange","bucket","price")
         DO UPDATE SET "buyVol" = "ObFootprintRollup"."buyVol" + EXCLUDED."buyVol",
                       "sellVol" = "ObFootprintRollup"."sellVol" + EXCLUDED."sellVol"`,
        params,
      );
    } catch (err) {
      console.error(`[rollup] flush футпринта ошибка ${key}: ${err.message}`);
    }
  }
}

async function flushTradeRollup(curBucket) {
  for (const [key, e] of tradeRollup) {
    if (e.bucketMs >= curBucket) continue;
    tradeRollup.delete(key);
    if (e.buyVol === 0 && e.sellVol === 0 && e.trades === 0) continue;
    try {
      await pool.query(
        `INSERT INTO "ObTradeRollup" ("symbol","exchange","bucket","buyVol","sellVol","trades")
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT ("symbol","exchange","bucket")
         DO UPDATE SET "buyVol" = "ObTradeRollup"."buyVol" + EXCLUDED."buyVol",
                       "sellVol" = "ObTradeRollup"."sellVol" + EXCLUDED."sellVol",
                       "trades" = "ObTradeRollup"."trades" + EXCLUDED."trades"`,
        [e.symbol, e.exchange, new Date(e.bucketMs), e.buyVol, e.sellVol, e.trades],
      );
    } catch (err) {
      console.error(`[rollup] flush ленты ошибка ${key}: ${err.message}`);
    }
  }
}

// Сбрасываем в БД все бакеты, чья минута уже завершилась (bucketMs < текущей
// минуты). Upsert (ON CONFLICT) — на случай рестарта коллектора посреди минуты.
async function flushRollup(now) {
  const curBucket = Math.floor(now.getTime() / 60_000) * 60_000;
  await flushTradeRollup(curBucket);
  await flushFootprintRollup(now);
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

// Асинхронный «beat» для flush rollup — не блокирует запись снапшотов.
// flushRollup сбрасывает бакет, только когда его минута уже завершилась —
// при интервале 1000мс это означало 60 холостых вызовов в минуту (лишняя,
// хоть и дешёвая, постоянная нагрузка на слабом сервере). Вместо этого
// планируем один вызов сразу после границы минуты + небольшой запас, чтобы
// последние снапшоты той минуты успели попасть в accumulateRollup.
function startRollupFlushBeat() {
  const FLUSH_INTERVAL_MS = 60_000;
  const FLUSH_OFFSET_MS = 1_000;
  const run = () => {
    flushRollup(new Date()).catch(err => console.error(`[rollup-beat] ошибка: ${err.message}`));
  };
  const state = { timer: null };
  const now = Date.now();
  const firstRunAt = Math.ceil((now + 1) / FLUSH_INTERVAL_MS) * FLUSH_INTERVAL_MS + FLUSH_OFFSET_MS;
  state.timer = setTimeout(() => {
    run();
    state.timer = setInterval(run, FLUSH_INTERVAL_MS);
  }, firstRunAt - now);
  return state;
}

// Последний снапшот стакана — одна строка на (symbol, exchange), перезаписывается
// на каждом тике. Профиль текущего стакана читает её по PK вместо поиска MAX(t)
// по сырому ObSnapshot на каждый опрос orderflow.
async function writeLatestBooks(books) {
  for (const [symbol, exchange, t, mid, rows] of books) {
    if (mid == null || rows.length === 0) continue;
    // Формат тот же, что уходит в ObSnapshot: [symbol, exchange, t, price, bid, ask].
    const levels = rows.map((r) => ({ price: r[3], bidVol: r[4], askVol: r[5] }));
    try {
      await pool.query(
        `INSERT INTO "ObLatestBook" ("symbol","exchange","t","mid","levels")
         VALUES ($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT ("symbol","exchange")
         DO UPDATE SET "t" = EXCLUDED."t", "mid" = EXCLUDED."mid", "levels" = EXCLUDED."levels"`,
        [symbol, exchange, t, mid, JSON.stringify(levels)],
      );
    } catch (err) {
      console.error(`[write] ObLatestBook ошибка ${symbol}|${exchange}: ${err.message}`);
    }
  }
}

async function writeSnapshot() {
  const t = new Date();
  const rows = [];
  const latestBooks = [];
  for (const feed of feeds) {
    const { rows: r, mid } = rowsForFeed(feed, t);
    const m = metricFor(`${feed.exchange}:${feed.symbol}`);
    m.obRows += r.length;
    m.obLastBins = r.length;
    m.lastWriteAt = t.toISOString();
    rows.push(...r);
    accumulateRollup(feed.symbol, feed.exchange, t, r, mid);
    latestBooks.push([feed.symbol, feed.exchange, t, mid, r]);
  }
  await writeLatestBooks(latestBooks);
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
    const { buyVol, sellVol, count, footprint, big } = tf.trades.drain();
    const m = metricFor(`${tf.exchange}:${tf.symbol}`);
    if (buyVol !== 0 || sellVol !== 0) {
      tRows.push([tf.symbol, tf.exchange, t, buyVol, sellVol, count]);
      accumulateTradeRollup(tf.symbol, tf.exchange, t, buyVol, sellVol, count);
      m.deltaRows += 1;
    }
    accumulateFootprintRollup(tf.symbol, tf.exchange, t, footprint);
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
      const b = i * 6;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
      params.push(...r);
    });
    try {
      await pool.query(
        `INSERT INTO "ObTrade" ("symbol","exchange","t","buyVol","sellVol","trades") VALUES ` + values.join(","),
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

/** Создать/обновить сторожевые метки ретеншна.
 *  При первом запуске — создаёт с epoch_start = NOW().
 *  При повторных — обновляет retention_days из .env, но НЕ трогает epoch_start
 *  (чтобы отсчёт не сбрасывался при смене конфига). */
async function ensureRetentionEpochs() {
  const categories = [
    { category: "snapshot", days: cfg.retentionDays },
    { category: "trade",    days: cfg.tradeRetentionDays },
    { category: "candle",   days: cfg.candleRetentionDays },
  ];
  for (const { category, days } of categories) {
    // Вставка только если нет записи
    await pool.query(
      `INSERT INTO "RetentionEpoch" ("id", "category", "epoch_start", "retention_days", "updated_at")
       VALUES (gen_random_uuid()::text, $1, NOW(), $2, NOW())
       ON CONFLICT ("category") DO NOTHING`,
      [category, days],
    );
    // Обновить retention_days из .env, если изменился (epoch_start не трогаем)
    await pool.query(
      `UPDATE "RetentionEpoch"
       SET "retention_days" = $2, "updated_at" = NOW()
       WHERE "category" = $1 AND "retention_days" <> $2`,
      [category, days],
    );
  }
}

/** Обновить epoch_start для категории после очистки. */
async function updateEpoch(category, retentionDays) {
  await pool.query(
    `UPDATE "RetentionEpoch"
     SET "epoch_start" = NOW(), "retention_days" = $2, "updated_at" = NOW()
     WHERE "category" = $1`,
    [category, retentionDays],
  );
}

/** Прочитать все epoch из БД и вернуть Map<category, {epochStart, retentionDays}>. */
let epochsCache = null;
let epochsCacheAt = 0;
async function getEpochs() {
  const now = Date.now();
  if (epochsCache && now - epochsCacheAt < 60_000) return epochsCache;
  const { rows } = await pool.query(
    `SELECT category, epoch_start, retention_days FROM "RetentionEpoch"`,
  );
  const map = {};
  for (const row of rows) {
    map[row.category] = { epochStart: row.epoch_start, retentionDays: row.retention_days };
  }
  epochsCache = map;
  epochsCacheAt = now;
  return map;
}

// BRIN-индексы по bucket на rollup-таблицах.
//
// Нужны ровно одному запросу — DELETE в pruneOld() по границе времени (и
// ручной чистке из админки). Прежние btree по (bucket) стоили ~16 Б на строку,
// то есть гигабайты на сотнях миллионов строк; BRIN на append-only времени
// весит килобайты и для диапазонного условия работает не хуже.
//
// Создаём здесь, а не в SQL-миграции app: CONCURRENTLY нельзя выполнить внутри
// транзакции, в которую Prisma заворачивает миграцию, а обычный CREATE INDEX
// заблокировал бы вставки на минуты — и накопленные бакеты потерялись бы
// (flushRollup удаляет бакет из памяти до записи).
const ROLLUP_BRIN = [
  ["ObSnapshotRollup", "ObSnapshotRollup_bucket_brin"],
  ["ObFootprintRollup", "ObFootprintRollup_bucket_brin"],
  ["ObTradeRollup", "ObTradeRollup_bucket_brin"],
  ["ObRollupBucket", "ObRollupBucket_bucket_brin"],
];

async function ensureRollupIndexes() {
  for (const [tbl, idx] of ROLLUP_BRIN) {
    try {
      // Прерванный CONCURRENTLY оставляет индекс невалидным: он не используется
      // планировщиком и молча тормозит чистку. Такой сносим и строим заново.
      const { rows } = await pool.query(
        `SELECT i.indisvalid FROM pg_class c
         JOIN pg_index i ON i.indexrelid = c.oid
         WHERE c.relname = $1`,
        [idx],
      );
      if (rows.length && rows[0].indisvalid === false) {
        await pool.query(`DROP INDEX CONCURRENTLY IF EXISTS "${idx}"`);
      } else if (rows.length) {
        continue;
      }
      await pool.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${idx}" ON "${tbl}" USING brin ("bucket")`,
      );
      console.log(`[index] BRIN ${idx} готов`);
    } catch (err) {
      // Не фатально: без индекса чистка просто идёт медленнее.
      console.error(`[index] ${idx}: ${err.message}`);
    }
  }
}

async function pruneOld() {
  try {
    for (const tbl of PARTITIONED_TABLES) {
      await pool.query(`SELECT ob_ensure_partitions($1, 7)`, [tbl]);
    }
    let snapDropped = 0;
    let tradeDropped = 0;
    // Snapshot-таблица — отдельный ретеншн (короткий, данные тяжёлые)
    {
      const r = await pool.query(
        `SELECT ob_drop_partitions_before($1, NOW() - ($2 || ' days')::interval) AS n`,
        ["ObSnapshot", String(cfg.retentionDays)],
      );
      snapDropped = r.rows[0]?.n ?? 0;
    }
    // Сделки, футпринт, крупные ордера — другой ретеншн (дольше, легковеснее)
    {
      const r = await pool.query(
        `SELECT ob_drop_partitions_before($1, NOW() - ($2 || ' days')::interval) AS n`,
        ["ObTrade", String(cfg.tradeRetentionDays)],
      );
      tradeDropped += r.rows[0]?.n ?? 0;
    }
    {
      const r = await pool.query(
        `SELECT ob_drop_partitions_before($1, NOW() - ($2 || ' days')::interval) AS n`,
        ["ObFootprint", String(cfg.tradeRetentionDays)],
      );
      tradeDropped += r.rows[0]?.n ?? 0;
    }
    {
      const r = await pool.query(
        `SELECT ob_drop_partitions_before($1, NOW() - ($2 || ' days')::interval) AS n`,
        ["ObBigTrade", String(cfg.tradeRetentionDays)],
      );
      tradeDropped += r.rows[0]?.n ?? 0;
    }
    const total = snapDropped + tradeDropped;
    // Rollup‑таблицы — НЕ партиционированы, чистим DELETE‑ом по ROLLUP_RETENTION_DAYS.
    //
    // rollupRetention <= 0 означает «хранить вечно» — это дефолт: агрегаты и
    // есть вся история лимиток. Проверка обязательна: без неё интервал
    // '0 days' означал бы «удалить всё до текущего момента», то есть ровно
    // противоположное задуманному.
    let rollupDeleted = 0;
    if (cfg.rollupRetention > 0) {
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
    {
      const r = await pool.query(
        `DELETE FROM "ObTradeRollup" WHERE bucket < NOW() - ($1 || ' days')::interval`,
        [String(cfg.rollupRetention)],
      );
      rollupDeleted += r.rowCount ?? 0;
    }
    {
      const r = await pool.query(
        `DELETE FROM "ObFootprintRollup" WHERE bucket < NOW() - ($1 || ' days')::interval`,
        [String(cfg.rollupRetention)],
      );
      rollupDeleted += r.rowCount ?? 0;
    }
    }
    // Свечи (ObCandle) НЕ чистим автоматически — в отличие от снапшотов/сделок/
    // rollup, история OHLCV лёгкая и ценна сама по себе (лежит в основе
    // ленивой подгрузки графика). Раньше здесь был DELETE по
    // CANDLE_RETENTION_DAYS, что противоречило описанию ручной очистки в
    // /api/admin/collector/purge-candles ("чистятся только вручную из
    // админки") и рвало историю графика без ведома пользователя. Удаление —
    // только через админку "Очистка свечей (OHLCV)".
    // Обновляем epoch только если что-то реально удалили — иначе отсчёт
    // сбрасывался бы каждый час, и пользователь всегда видел бы полный retention.
    if (snapDropped) await updateEpoch("snapshot", cfg.retentionDays);
    if (tradeDropped || rollupDeleted) {
      await updateEpoch("trade", cfg.tradeRetentionDays);
    }
    if (total || rollupDeleted) {
      console.log(
        `[prune] сброшено ${total} партиций (снапшоты: ${cfg.retentionDays}д, сделки: ${cfg.tradeRetentionDays}д); ` +
        `удалено ${rollupDeleted} строк rollup ` +
        `(retention: ${cfg.rollupRetention > 0 ? `${cfg.rollupRetention}д` : "вечно"})`,
      );
    }
  } catch (err) {
    console.error(`[prune] ошибка: ${err.message}`);
  }
}

// Healthcheck для платформы хостинга.
const server = http.createServer(async (req, res) => {
  const url = (req.url ?? "").split("?")[0];
  if (url === "/health" || url === "/") {
    const status = feeds.map((f) => ({ feed: `${f.exchange}:${f.symbol}`, synced: f.book.synced, ...f.book.stats }));
    const healthy = feeds.some((f) => f.book.synced);
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ healthy, feeds: status }));
  } else if (url === "/scan-daily") {
    // Загрузка свежих дневных свечей с Binance по запросу приложения: кнопка
    // «Пересчитать сейчас» и ночной плановый прогон сначала дёргают этот
    // эндпоинт, чтобы уровни считались по только что закрытому бару, а не по
    // тому, что осталось от прошлого прохода суточного таймера.
    // Защита — тот же bearer-токен, что у /metrics.
    const auth = req.headers["authorization"] ?? "";
    if (!cfg.metricsToken || auth !== `Bearer ${cfg.metricsToken}`) {
      res.writeHead(cfg.metricsToken ? 401 : 404);
      res.end();
      return;
    }
    // POST запускает скан (если он уже идёт — просто отдаём его прогресс),
    // GET только отдаёт статус для поллинга.
    let started = false;
    if (req.method === "POST" && !allPairsScanRunning) {
      started = true;
      scanAllUsdtPairsDaily(); // намеренно без await: клиент опрашивает статус
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ started, ...allPairsScanState }));
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
    // Добавляем epoch-данные для отсчёта очистки (асинхронно, кэшируется).
    // Если запрос не удался — отдаём ответ без epochs.
    const epochs = await getEpochs().catch(() => ({}));
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
      epochs,
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

// Бэкафилл rollup ленты из сырого ObTrade. Нужен, чтобы дельта/CVD работали на
// уже накопленной истории сразу после деплоя, а не только на новых данных.
// Поле trades у старых строк = 0 (счётчик печатей появился вместе с этой
// таблицей), поэтому «скорость ленты» на исторических окнах будет нулевой,
// пока не наберутся свежие минуты — раньше она там показывала не ноль, а
// бессмысленную константу (частоту опроса коллектора).
async function backfillTradeRollup() {
  try {
    const { rows } = await pool.query(`SELECT 1 FROM "ObTradeRollup" LIMIT 1`);
    if (rows.length > 0) return;
    console.log("[rollup] бэкафилл ленты из ObTrade…");
    await pool.query(
      `INSERT INTO "ObTradeRollup" ("symbol","exchange","bucket","buyVol","sellVol","trades")
       SELECT "symbol", "exchange", date_trunc('minute', "t"),
              SUM("buyVol"), SUM("sellVol"), COALESCE(SUM("trades"), 0)::int
       FROM "ObTrade"
       GROUP BY "symbol", "exchange", date_trunc('minute', "t")
       ON CONFLICT ("symbol","exchange","bucket") DO NOTHING`,
    );
    console.log("[rollup] бэкафилл ленты завершён");
  } catch (err) {
    console.error(`[rollup] бэкафилл ленты ошибка: ${err.message}`);
  }
}

// ─── Каскад агрегатов стакана: час и сутки поверх минутного rollup ─────────
//
// Зачем (см. ORDERFLOW_PERF_PLAN.md §4): окно карты на старших таймфреймах —
// месяцы и годы, а колонок на графике всегда 240. На "1d" колонка шириной 36
// часов, и складывать в неё 2160 минутных строк незачем: результат тот же, что
// у одной дневной. Минутный уровень при этом остаётся полным и вечным.
//
// Свёртка идемпотентна: повторный прогон того же периода ПЕРЕЗАПИСЫВАЕТ суммы
// (DO UPDATE SET = EXCLUDED), а не прибавляет их. Поэтому её можно гонять по
// расписанию, не отслеживая, что уже посчитано, и безопасно пересчитывать
// период заново, если в минутный уровень задним числом доехали данные.
//
// Порция ограничена: первый прогон на годовой истории иначе стал бы одной
// гигантской транзакцией на слабом сервере. Остаток догоняется следующими
// прогонами (раз в 5 минут), пока каскад не поравняется с минутным уровнем.
const CASCADE_CHUNK_HOURS = 24 * 14; // сколько периодов сворачиваем за прогон
const CASCADE_CHUNK_DAYS = 90;

/**
 * Свернуть один уровень каскада.
 *
 * @param srcPrices  таблица цен-источник  (минутная для часового уровня, часовая для дневного)
 * @param dstPrices  таблица цен-приёмник
 * @param srcSnaps   таблица счётчиков-источник
 * @param dstSnaps   таблица счётчиков-приёмник
 * @param unit       'hour' | 'day' — шаг целевого бакета
 * @param limit      сколько целевых периодов обработать за прогон
 * @returns сколько строк цен записано
 */
async function rollupLevel(srcPrices, dstPrices, srcSnaps, dstSnaps, unit, limit) {
  // Откуда продолжать: последний уже свёрнутый период (его считаем заново — он
  // почти наверняка был неполным), иначе — начало истории источника.
  //
  // Данные, доехавшие в источник ЗАДНИМ ЧИСЛОМ раньше этой границы, прогон не
  // подхватит: чтобы пересобрать каскад целиком, целевые таблицы очищают, и
  // ближайшие прогоны наполняют их заново порциями.
  const { rows: state } = await pool.query(
    `SELECT (SELECT MAX("bucket") FROM "${dstPrices}") AS done,
            (SELECT MIN("bucket") FROM "${srcPrices}") AS first`,
  );
  const from = state[0]?.done ?? state[0]?.first;
  if (!from) return 0; // источник пуст — сворачивать нечего

  // Границы порции. Текущий, ещё не завершённый период ВКЛЮЧАЕМ: иначе правый
  // край карты — самое интересное место — на дневном уровне был бы пустым до
  // полуночи UTC. Свёртка идемпотентна (перезапись, не сложение), поэтому
  // незавершённый период просто пересчитывается на каждом прогоне; он дешёвый —
  // день собирается из двух десятков часовых строк, час из шестидесяти минутных.
  const bounds = `
    WITH b AS (
      SELECT date_trunc($2, $1::timestamptz) AS lo,
             LEAST(date_trunc($2, now()) + ('1 ${unit}')::interval,
                   date_trunc($2, $1::timestamptz) + ($3 || ' ${unit}')::interval) AS hi
    )`;

  const { rowCount } = await pool.query(
    `${bounds}
     INSERT INTO "${dstPrices}" ("symbol","exchange","bucket","price","volSum","bidSum","askSum")
     SELECT s."symbol", s."exchange", date_trunc($2, s."bucket") AS bkt, s."price",
            SUM(s."volSum"), SUM(s."bidSum"), SUM(s."askSum")
     FROM "${srcPrices}" s, b
     WHERE s."bucket" >= b.lo AND s."bucket" < b.hi
     GROUP BY s."symbol", s."exchange", bkt, s."price"
     ON CONFLICT ("symbol","exchange","bucket","price")
     DO UPDATE SET "volSum" = EXCLUDED."volSum",
                   "bidSum" = EXCLUDED."bidSum",
                   "askSum" = EXCLUDED."askSum"`,
    [from, unit, String(limit)],
  );

  // Счётчики снапшотов — тем же окном: из них computeOrderflow берёт нормировку
  // (число бирж / число снапшотов в колонке), и разъехавшись с ценами она
  // исказила бы яркость карты.
  await pool.query(
    `${bounds}
     INSERT INTO "${dstSnaps}" ("symbol","exchange","bucket","snaps","midSum")
     SELECT s."symbol", s."exchange", date_trunc($2, s."bucket") AS bkt,
            SUM(s."snaps")::int, SUM(s."midSum")
     FROM "${srcSnaps}" s, b
     WHERE s."bucket" >= b.lo AND s."bucket" < b.hi
     GROUP BY s."symbol", s."exchange", bkt
     ON CONFLICT ("symbol","exchange","bucket")
     DO UPDATE SET "snaps" = EXCLUDED."snaps", "midSum" = EXCLUDED."midSum"`,
    [from, unit, String(limit)],
  );

  return rowCount ?? 0;
}

/**
 * Свёртка футпринта: часовой уровень из пятиминутного. Отдельная функция, а не
 * rollupLevel: у футпринта другие колонки (buyVol/sellVol) и нет парной таблицы
 * счётчиков — нормировать кластеры не нужно, они складываются как есть.
 */
async function rollupFootprintLevel(limit) {
  const { rows: state } = await pool.query(
    `SELECT (SELECT MAX("bucket") FROM "ObFootprintRollupH") AS done,
            (SELECT MIN("bucket") FROM "ObFootprintRollup") AS first`,
  );
  const from = state[0]?.done ?? state[0]?.first;
  if (!from) return 0;

  const { rowCount } = await pool.query(
    `WITH b AS (
       SELECT date_trunc('hour', $1::timestamptz) AS lo,
              LEAST(date_trunc('hour', now()) + interval '1 hour',
                    date_trunc('hour', $1::timestamptz) + ($2 || ' hour')::interval) AS hi
     )
     INSERT INTO "ObFootprintRollupH" ("symbol","exchange","bucket","price","buyVol","sellVol")
     SELECT s."symbol", s."exchange", date_trunc('hour', s."bucket") AS bkt, s."price",
            SUM(s."buyVol"), SUM(s."sellVol")
     FROM "ObFootprintRollup" s, b
     WHERE s."bucket" >= b.lo AND s."bucket" < b.hi
     GROUP BY s."symbol", s."exchange", bkt, s."price"
     ON CONFLICT ("symbol","exchange","bucket","price")
     DO UPDATE SET "buyVol" = EXCLUDED."buyVol", "sellVol" = EXCLUDED."sellVol"`,
    [from, String(limit)],
  );
  return rowCount ?? 0;
}

async function rollupCascade() {
  try {
    const h = await rollupLevel(
      "ObSnapshotRollup", "ObSnapshotRollupH",
      "ObRollupBucket", "ObRollupBucketH",
      "hour", CASCADE_CHUNK_HOURS,
    );
    // Дневной уровень строим из часового, а не из минутного: он уже в сотни раз
    // меньше, и суммы совпадают — сложение ассоциативно.
    const d = await rollupLevel(
      "ObSnapshotRollupH", "ObSnapshotRollupD",
      "ObRollupBucketH", "ObRollupBucketD",
      "day", CASCADE_CHUNK_DAYS,
    );
    const fp = await rollupFootprintLevel(CASCADE_CHUNK_HOURS);
    if (h || d || fp) console.log(`[cascade] свёрнуто строк: час=${h} сутки=${d} футпринт=${fp}`);
  } catch (err) {
    console.error(`[cascade] ошибка: ${err.message}`);
  }
}

// Бэкафилл rollup футпринта из сырого ObFootprint — чтобы кластеры работали на
// уже накопленной истории сразу после деплоя.
async function backfillFootprintRollup() {
  try {
    const { rows } = await pool.query(`SELECT 1 FROM "ObFootprintRollup" LIMIT 1`);
    if (rows.length > 0) return;
    console.log("[rollup] бэкафилл футпринта из ObFootprint…");
    await pool.query(
      `INSERT INTO "ObFootprintRollup" ("symbol","exchange","bucket","price","buyVol","sellVol")
       SELECT "symbol", "exchange",
              to_timestamp(floor(extract(epoch from "t") / 300) * 300),
              "price", SUM("buyVol"), SUM("sellVol")
       FROM "ObFootprint"
       GROUP BY "symbol", "exchange",
                to_timestamp(floor(extract(epoch from "t") / 300) * 300), "price"
       ON CONFLICT ("symbol","exchange","bucket","price") DO NOTHING`,
    );
    console.log("[rollup] бэкафилл футпринта завершён");
  } catch (err) {
    console.error(`[rollup] бэкафилл футпринта ошибка: ${err.message}`);
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
// Каскад агрегатов. Раз в 5 минут: свежий час подхватывается быстро, а на
// исторической глубине прогоны идут порциями, пока каскад не догонит минутный
// уровень (первый раз на годовой истории это несколько прогонов).
const cascadeTimer = setInterval(rollupCascade, 5 * 60_000);
setTimeout(rollupCascade, 45_000);
setTimeout(async () => {
  await ensureRetentionEpochs();
  // Индексы — до первой чистки: BRIN по bucket нужен именно её DELETE-ам.
  await ensureRollupIndexes();
  await pruneOld();
}, 10_000);

// Свечи — раз в 60 секунд, первый запуск через 15с (после бэкафилла)
const candleTimer = setInterval(fetchAndStoreCandles, 60_000);
setTimeout(fetchAndStoreCandles, 15_000);
setTimeout(backfillCandles, 30_000);

// Полный скан USDT-пар (фича "Рекомендации") — раз в сутки, первый запуск
// через 60с (даём стартовать обычному бэкафиллу первым).
let allPairsScanTimer = null;
if (cfg.scanAllUsdtPairs) {
  allPairsScanTimer = setInterval(scanAllUsdtPairsDaily, cfg.allPairsScanIntervalMs);
  setTimeout(scanAllUsdtPairsDaily, 60_000);
}

async function shutdown() {
  clearInterval(writeTimer);
  clearInterval(flushTimer.timer);
  clearInterval(pruneTimer);
  clearInterval(cascadeTimer);
  clearInterval(configTimer);
  clearInterval(candleTimer);
  if (allPairsScanTimer) clearInterval(allPairsScanTimer);
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
export { binSide, rowsForFeed, accumulateRollup, flushRollup, writeSnapshot, pruneOld, loadCollectorConfig, backfillRollup, fetchAndStoreCandles, backfillCandles, rollupCascade, rollupLevel, rollupFootprintLevel };
export { FACTORY, DEFAULT_BIN, DEFAULT_MIN_COINS, marketOf, minCoinsFor };
export { fetchUsdtFuturesSymbols, scanAllUsdtPairsDaily };
