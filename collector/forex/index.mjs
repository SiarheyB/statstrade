// Forex collector — Finnhub WebSocket (реальные тики) как основной источник +
// Twelve Data REST как источник истории и fallback-догон.
//
// Почему так:
//   Twelve Data free tier (800 запросов/день, 8/мин) не тянет обновление
//   каждые 5 минут по всем мажорам × всем таймфреймам — уходит в лимит.
//   Finnhub free tier даёт WebSocket с тиками (сделками) без ограничения на
//   число сообщений (лимитируется только число подписанных символов, до 50) —
//   поэтому коллектор сам агрегирует тики в свечи 5m/15m/1h/4h/1d/1w в
//   памяти и льёт их в Postgres. REST /forex/candle у Finnhub — premium-only
//   на free-плане, поэтому для истории и на случай обрыва WS используется
//   Twelve Data (батчим до 8 символов в одном запросе).
//
// Архитектура:
//   Finnhub WS (тики) → агрегатор свечей в памяти → Postgres (FxCandle, exchange="finnhub")
//   Twelve Data REST  → бэкафилл истории при старте + периодический fallback-догон
//                        (пишет в тот же exchange="finnhub", т.к. это тот же логический ряд)
//
// Ограничения free tier:
//   Twelve Data: 8 запросов/мин, 800/день, до 8 символов в одном запросе.
//   Finnhub: WS без лимита на сообщения, до 50 подписанных символов.

import http from "node:http";
import pg from "pg";

// ─── Конфигурация из ENV ──────────────────────────────────────────────────

const cfg = {
  symbols: (process.env.FX_SYMBOLS ?? "EUR/USD,GBP/USD,USD/JPY,USD/CHF,AUD/USD,NZD/USD,EUR/JPY,GBP/JPY")
    .split(",").map(s => s.trim()).filter(Boolean),

  // Единый тег источника для всех свечей форекса (и WS, и REST-бэкафилл
  // пишут под одним exchange — это один логический ряд для приложения).
  exchange: "finnhub",

  twelveDataApiKey: process.env.TWELVEDATA_API_KEY ?? "",
  twelveDataApiBase: process.env.TWELVEDATA_API_BASE ?? "https://api.twelvedata.com",

  finnhubApiKey: process.env.FINNHUB_API_KEY ?? "",
  finnhubWsUrl: process.env.FINNHUB_WS_URL ?? "wss://ws.finnhub.io",

  // Как часто Twelve Data досогласовывает историю (fallback-догон), сек.
  // Не критично для реального времени — это только подстраховка на случай
  // обрыва Finnhub WS или пропущенных тиков.
  fallbackIntervalSec: Number(process.env.FX_FALLBACK_INTERVAL_SEC ?? 900),

  // Как часто сбрасывать в БД текущие (ещё открытые) свечи, собранные из тиков.
  flushIntervalSec: Number(process.env.FX_FLUSH_INTERVAL_SEC ?? 15),

  candleRetentionDays: Number(process.env.FX_CANDLE_RETENTION_DAYS ?? 365),

  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT ?? 8081),
};

if (!cfg.databaseUrl) {
  console.error("[fx] FATAL: DATABASE_URL не задан");
  process.exit(1);
}

if (!cfg.finnhubApiKey) {
  console.error("[fx] FATAL: FINNHUB_API_KEY не задан");
  process.exit(1);
}

// ─── Postgres ──────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 4 });

// ─── Таймфреймы ───────────────────────────────────────────────────────────

const TF_MAP = {
  "5m": "5min",
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
  "1w": "1week",
};

const CANDLE_INTERVALS = Object.keys(TF_MAP);

const INTERVAL_MS = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

// Начало бакета для таймфрейма (UTC). Для 1w — начало ISO-недели (понедельник 00:00 UTC).
function bucketStart(ms, interval) {
  if (interval === "1w") {
    const d = new Date(ms);
    const day = d.getUTCDay(); // 0=Sun..6=Sat
    const diffToMonday = (day + 6) % 7; // Пн=0
    const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday);
    return monday;
  }
  // 4h у Twelve Data выровнен не по UTC-полночи, а по границе торгового дня
  // форекса (01:00/05:00/09:00/13:00/17:00/21:00 UTC) — сдвиг на 1 час от
  // «наивной» сетки от эпохи. Без этого офсета WS-агрегированный бакет и
  // TD-бар почти совпадают по времени и рисуются как две налезающие друг на
  // друга свечи.
  if (interval === "4h") {
    const anchor = 60 * 60_000; // 1 час
    return Math.floor((ms - anchor) / INTERVAL_MS["4h"]) * INTERVAL_MS["4h"] + anchor;
  }

  const span = INTERVAL_MS[interval];
  return Math.floor(ms / span) * span;
}

// ─── Символы: наш формат "EUR/USD" ↔ Finnhub "OANDA:EUR_USD" ──────────────

function toFinnhubSymbol(symbol) {
  return `OANDA:${symbol.replace("/", "_")}`;
}

function fromFinnhubSymbol(fhSymbol) {
  const raw = fhSymbol.startsWith("OANDA:") ? fhSymbol.slice(6) : fhSymbol;
  return raw.replace("_", "/");
}

// ─── Rate limiter для Twelve Data ──────────────────────────────────────────

// Twelve Data считает кредиты ПО СИМВОЛУ в батч-запросе, а не по HTTP-вызову —
// запрос с 6 символами стоит 6 кредитов из тех же 8/мин. Поэтому лимитер
// учитывает стоимость (cost) каждого вызова, а не просто минимальный интервал.
class RateLimiter {
  constructor(creditsPerMinute = 8) {
    this._creditsPerMinute = creditsPerMinute;
    this._lastCall = 0;
  }

  async wait(cost = 1) {
    const now = Date.now();
    // Twelve Data использует скользящее окно (не жёстко по границе минуты) —
    // берём запас с округлением вверх до целой минуты, а не пропорциональный
    // интервал, иначе соседние окна пересекаются и ловим 429.
    const intervalMs = 60_000 * Math.ceil(cost / this._creditsPerMinute) + 2000;
    const wait = Math.max(0, this._lastCall + intervalMs - now);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this._lastCall = Date.now();
  }
}

const rateLimiter = new RateLimiter(8);

// ─── Состояние коллектора ─────────────────────────────────────────────────

const startedAt = Date.now();
let writeErrors = 0;
let lastWriteOkAt = 0;
let totalTwelveDataCalls = 0;
let backfillDone = false;
let wsConnected = false;
let wsReconnects = 0;
let lastTradeAt = 0;
let totalTrades = 0;

// ─── Twelve Data: история и fallback-догон ────────────────────────────────
//
// Символы батчатся: до 8 штук в одном запросе на interval, а не по одному —
// это снижает число запросов в разы против прежней версии коллектора.

async function fetchTimeSeriesBatch(symbols, interval, outputsize) {
  await rateLimiter.wait(symbols.length);
  const symStr = symbols.join(",");
  // timezone=UTC обязателен: без него Twelve Data отдаёт datetime в своей
  // "биржевой" таймзоне (для форекса — не UTC), и это выглядит как сдвиг
  // свечей в будущее относительно реального времени.
  const url = `${cfg.twelveDataApiBase}/time_series?symbol=${encodeURIComponent(symStr)}&interval=${interval}&outputsize=${outputsize}&timezone=UTC&apikey=${cfg.twelveDataApiKey}`;
  totalTwelveDataCalls++;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[fx/td] HTTP ${res.status} для ${symStr} ${interval}: ${text.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    if (data.status === "error") {
      console.error(`[fx/td] Twelve Data error: ${data.message ?? JSON.stringify(data)}`);
      return null;
    }
    return data;
  } catch (err) {
    console.error(`[fx/td] fetch error ${symStr} ${interval}: ${err.message}`);
    return null;
  }
}

// Ответ на батч из нескольких символов: { "EUR/USD": { status, values }, ... }
// Ответ на один символ: { status, values } напрямую.
function extractSymbolValues(data, symbol, requestedMultiple) {
  if (!data) return null;
  if (!requestedMultiple && data.values) return data.values;
  const entry = data[symbol];
  if (entry?.values) return entry.values;
  return null;
}

function toCandleRow(value, symbol, interval) {
  const dt = value.datetime;
  const t = dt.includes(" ") ? new Date(dt + " UTC") : new Date(dt + "T00:00:00Z");
  return {
    symbol,
    exchange: cfg.exchange,
    interval,
    t,
    o: parseFloat(value.open),
    h: parseFloat(value.high),
    l: parseFloat(value.low),
    c: parseFloat(value.close),
    v: parseFloat(value.volume ?? 0),
  };
}

async function storeCandleRows(rows) {
  if (rows.length === 0) return 0;

  const values = [];
  const params = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const b = params.length;
    values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`);
    params.push(r.symbol, r.exchange, r.interval, r.t, r.o, r.h, r.l, r.c, r.v);
  }

  try {
    await pool.query(
      `INSERT INTO "FxCandle" ("symbol","exchange","interval","t","o","h","l","c","v")
       VALUES ${values.join(",")}
       ON CONFLICT ("symbol","exchange","interval","t") DO UPDATE SET
         "h" = EXCLUDED."h", "l" = EXCLUDED."l", "c" = EXCLUDED."c", "v" = EXCLUDED."v"`,
      params,
    );
    writeErrors = 0;
    lastWriteOkAt = Date.now();
    return rows.length;
  } catch (err) {
    writeErrors++;
    console.error(`[fx/store] error: ${err.message}`);
    return 0;
  }
}

// Бэкафилл/догон для одного таймфрейма по всем символам разом (батч).
async function fetchAndStoreBatch(interval, outputsize) {
  const twelveInterval = TF_MAP[interval];
  if (!twelveInterval) return 0;
  if (!cfg.twelveDataApiKey) return 0;

  const requestedMultiple = cfg.symbols.length > 1;
  const data = await fetchTimeSeriesBatch(cfg.symbols, twelveInterval, outputsize);
  if (!data) return 0;

  let stored = 0;
  for (const symbol of cfg.symbols) {
    const values = extractSymbolValues(data, symbol, requestedMultiple);
    if (!values || values.length === 0) continue;
    const rows = values.map(v => toCandleRow(v, symbol, interval));
    stored += await storeCandleRows(rows);
  }
  if (stored > 0) console.log(`[fx/td] ${interval}: +${stored} свечей (${cfg.symbols.length} пар за 1 запрос)`);
  return stored;
}

// На старте: полная история по всем таймфреймам (батчами по символам).
async function backfillAll() {
  if (!cfg.twelveDataApiKey) {
    console.log("[fx/td] TWELVEDATA_API_KEY не задан — бэкафилл истории пропущен, ждём накопления тиков из Finnhub");
    backfillDone = true;
    return;
  }
  console.log(`[fx/td] backfill: начинаем для ${cfg.symbols.length} символов, ${CANDLE_INTERVALS.length} таймфреймов (батч по символам)`);

  for (const interval of CANDLE_INTERVALS) {
    try {
      const r = await pool.query(
        `SELECT COUNT(*) as cnt FROM "FxCandle" WHERE "exchange"=$1 AND "interval"=$2`,
        [cfg.exchange, interval],
      );
      if (parseInt(r.rows[0]?.cnt ?? "0") > 100 * cfg.symbols.length) {
        console.log(`[fx/td] backfill: ${interval} — уже есть данные, пропускаем`);
        continue;
      }
    } catch (_) {
      // Таблица создастся при первой записи (миграцией) — просто продолжаем.
    }

    const outputsize = interval === "5m" || interval === "15m" ? 5000 : 2000;
    await fetchAndStoreBatch(interval, outputsize);
  }

  backfillDone = true;
  console.log(`[fx/td] backfill: завершён (всего запросов к Twelve Data: ${totalTwelveDataCalls})`);
}

// Периодический fallback-догон: подстраховка, если WS оборвался/пропустил тики.
// Батч по символам, редкий (fallbackIntervalSec) — не расходует лимит впустую.
async function fallbackCatchUp() {
  if (!cfg.twelveDataApiKey) return;
  for (const interval of CANDLE_INTERVALS) {
    const outputsize = interval === "5m" || interval === "15m" ? 20 : 5;
    await fetchAndStoreBatch(interval, outputsize);
  }
  console.log(`[fx/td] fallback-догон завершён (всего запросов: ${totalTwelveDataCalls})`);
}

// Бэкафилл истории для ОДНОГО символа (добавлен из админки после старта) —
// не батчим с остальными, чтобы не пересчитывать общий cfg.symbols на лету.
async function backfillOneSymbol(symbol) {
  if (!cfg.twelveDataApiKey) return;
  console.log(`[fx/td] backfill нового символа ${symbol}…`);
  for (const interval of CANDLE_INTERVALS) {
    const twelveInterval = TF_MAP[interval];
    if (!twelveInterval) continue;
    const outputsize = interval === "5m" || interval === "15m" ? 5000 : 2000;
    const data = await fetchTimeSeriesBatch([symbol], twelveInterval, outputsize);
    if (!data) continue;
    const values = extractSymbolValues(data, symbol, false);
    if (!values || values.length === 0) continue;
    const rows = values.map(v => toCandleRow(v, symbol, interval));
    const stored = await storeCandleRows(rows);
    if (stored > 0) console.log(`[fx/td] ${symbol} ${interval}: +${stored} свечей`);
  }
}

// ─── Finnhub WebSocket: тики → агрегация свечей в памяти ──────────────────

// state[symbol][interval] = { t (bucket start ms), o, h, l, c, v, dirty }
const liveCandles = new Map();

function getSymbolState(symbol) {
  let s = liveCandles.get(symbol);
  if (!s) {
    s = new Map();
    liveCandles.set(symbol, s);
  }
  return s;
}

function applyTrade(symbol, price, volume, tradeMs) {
  const symState = getSymbolState(symbol);
  for (const interval of CANDLE_INTERVALS) {
    const bStart = bucketStart(tradeMs, interval);
    const cur = symState.get(interval);
    if (!cur || cur.t !== bStart) {
      // Новый бакет — предыдущий уже был сброшен по таймеру, просто начинаем новый.
      symState.set(interval, { t: bStart, o: price, h: price, l: price, c: price, v: volume, dirty: true });
    } else {
      cur.h = Math.max(cur.h, price);
      cur.l = Math.min(cur.l, price);
      cur.c = price;
      cur.v += volume;
      cur.dirty = true;
    }
  }
}

// Сброс всех «грязных» (изменившихся с прошлого сброса) свечей в БД.
async function flushLiveCandles() {
  const rows = [];
  for (const [symbol, symState] of liveCandles) {
    for (const [interval, c] of symState) {
      if (!c.dirty) continue;
      rows.push({
        symbol,
        exchange: cfg.exchange,
        interval,
        t: new Date(c.t),
        o: c.o, h: c.h, l: c.l, c: c.c, v: c.v,
      });
      c.dirty = false;
    }
  }
  if (rows.length === 0) return;
  const stored = await storeCandleRows(rows);
  if (stored > 0) console.log(`[fx/ws] flush: ${stored} свечей обновлено из тиков`);
}

// ─── WebSocket-клиент с автопереподключением ───────────────────────────────

let ws = null;
let wsReconnectTimer = null;
let wsReconnectDelayMs = 2000;

function connectFinnhub() {
  const url = `${cfg.finnhubWsUrl}?token=${cfg.finnhubApiKey}`;
  console.log(`[fx/ws] подключение к Finnhub WS…`);

  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error(`[fx/ws] ошибка создания WebSocket: ${err.message}`);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    wsConnected = true;
    wsReconnectDelayMs = 2000;
    console.log(`[fx/ws] подключено, подписываемся на ${cfg.symbols.length} пар`);
    for (const symbol of cfg.symbols) {
      ws.send(JSON.stringify({ type: "subscribe", symbol: toFinnhubSymbol(symbol) }));
    }
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type !== "trade" || !Array.isArray(msg.data)) return;
    for (const trade of msg.data) {
      const symbol = fromFinnhubSymbol(trade.s);
      if (!cfg.symbols.includes(symbol)) continue;
      applyTrade(symbol, trade.p, trade.v ?? 0, trade.t ?? Date.now());
      totalTrades++;
      lastTradeAt = Date.now();
    }
  };

  ws.onerror = (event) => {
    // Node-шный нативный WebSocket (undici) не всегда кладёт причину в
    // event.message — пробуем все поля, где она может быть, чтобы не
    // печатать пустую строку вместо диагностики.
    const reason = event?.message || event?.error?.message || event?.error || String(event);
    console.error(`[fx/ws] ошибка: ${reason}`);
  };

  ws.onclose = (event) => {
    wsConnected = false;
    // code/reason из close-фрейма — часто это единственный способ понять
    // причину (неверный токен, лимит, сетевой обрыв и т.п.), т.к. onerror
    // сам по себе редко несёт полезную информацию.
    console.log(`[fx/ws] соединение закрыто (code=${event?.code ?? "?"} reason="${event?.reason ?? ""}"), переподключение через ${wsReconnectDelayMs}мс`);
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnects++;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectFinnhub();
  }, wsReconnectDelayMs);
  wsReconnectDelayMs = Math.min(wsReconnectDelayMs * 2, 60_000);
}

// ─── Чистка старого ──────────────────────────────────────────────────────

async function pruneOld() {
  try {
    const r = await pool.query(
      `DELETE FROM "FxCandle" WHERE "exchange"=$1 AND "t" < NOW() - ($2 || ' days')::interval`,
      [cfg.exchange, String(cfg.candleRetentionDays)],
    );
    if (r.rowCount > 0) console.log(`[fx/prune] FxCandle: удалено ${r.rowCount} строк`);
  } catch (err) {
    console.error(`[fx/prune] FxCandle: ${err.message}`);
  }
}

// ─── Список пар из админки (FxCollectorConfig) ────────────────────────────
//
// Источник истины — таблица FxCollectorConfig (управляется из админки без
// передеплоя). Если она пуста (свежий деплой, ничего ещё не настроено) —
// используем ENV FX_SYMBOLS как фоллбек-дефолт.

const envDefaultSymbols = [...cfg.symbols];

async function loadEnabledSymbolsFromDb() {
  try {
    const r = await pool.query(`SELECT symbol FROM "FxCollectorConfig" WHERE enabled = true ORDER BY symbol`);
    return r.rows.map(row => row.symbol);
  } catch (err) {
    console.error(`[fx/config] ошибка чтения FxCollectorConfig: ${err.message}`);
    return null; // не трогаем текущий список при ошибке БД
  }
}

// Сверяет активный список символов с БД, донастраивает WS-подписки и
// запускает бэкафилл для вновь добавленных пар. Ничего не делает, если
// список не изменился.
async function syncSymbolsFromConfig() {
  const dbSymbols = await loadEnabledSymbolsFromDb();
  if (dbSymbols === null) return; // ошибка БД — оставляем как есть
  const target = dbSymbols.length > 0 ? dbSymbols : envDefaultSymbols;

  const current = new Set(cfg.symbols);
  const next = new Set(target);
  const added = target.filter(s => !current.has(s));
  const removed = cfg.symbols.filter(s => !next.has(s));
  if (added.length === 0 && removed.length === 0) return;

  console.log(`[fx/config] изменение списка пар: +[${added.join(",")}] -[${removed.join(",")}]`);

  for (const symbol of removed) {
    if (wsConnected && ws) {
      try { ws.send(JSON.stringify({ type: "unsubscribe", symbol: toFinnhubSymbol(symbol) })); } catch { /* noop */ }
    }
    liveCandles.delete(symbol);
  }

  cfg.symbols.length = 0;
  cfg.symbols.push(...target);

  for (const symbol of added) {
    if (wsConnected && ws) {
      try { ws.send(JSON.stringify({ type: "subscribe", symbol: toFinnhubSymbol(symbol) })); } catch { /* noop */ }
    }
    backfillOneSymbol(symbol).catch(err => console.error(`[fx/config] backfill ${symbol}: ${err.message}`));
  }
}

// ─── HTTP healthcheck ────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = (req.url ?? "").split("?")[0];
  if (url === "/health" || url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      healthy: wsConnected || backfillDone,
      uptimeMs: Date.now() - startedAt,
      instruments: cfg.symbols.length,
      symbols: cfg.symbols,
      backfillDone,
      ws: {
        connected: wsConnected,
        reconnects: wsReconnects,
        totalTrades,
        lastTradeAt: lastTradeAt ? new Date(lastTradeAt).toISOString() : null,
      },
      twelveData: {
        apiKeySet: cfg.twelveDataApiKey.length > 0,
        totalCalls: totalTwelveDataCalls,
        fallbackIntervalSec: cfg.fallbackIntervalSec,
      },
      errors: writeErrors,
      lastWriteOkAt: lastWriteOkAt ? new Date(lastWriteOkAt).toISOString() : null,
      exchange: cfg.exchange,
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(cfg.port, () => {
  console.log(`[fx/health] http://0.0.0.0:${cfg.port}/health`);
});

// ─── Запуск ──────────────────────────────────────────────────────────────

async function start() {
  // 0. Список пар из админки (FxCollectorConfig), если настроен — иначе
  //    остаётся дефолт из ENV FX_SYMBOLS (envDefaultSymbols).
  await syncSymbolsFromConfig();

  console.log(`[fx/start] symbols=${cfg.symbols.join(",")} exchange=${cfg.exchange}`);

  // 1. Бэкафилл истории через Twelve Data (если задан ключ).
  backfillAll().catch(err => console.error(`[fx/backfill] fatal: ${err.message}`));

  // 2. Основной источник реального времени — Finnhub WS.
  connectFinnhub();
}
start().catch(err => console.error(`[fx/start] fatal: ${err.message}`));

// 3. Периодический сброс агрегированных из тиков свечей в БД.
const flushTimer = setInterval(() => {
  flushLiveCandles().catch(err => console.error(`[fx/flush] fatal: ${err.message}`));
}, cfg.flushIntervalSec * 1000);

// 4. Периодический fallback-догон через Twelve Data (подстраховка).
const fallbackTimer = setInterval(() => {
  fallbackCatchUp().catch(err => console.error(`[fx/fallback] fatal: ${err.message}`));
}, cfg.fallbackIntervalSec * 1000);

// 5. Чистка старого — раз в 6 часов.
const pruneTimer = setInterval(pruneOld, 6 * 3600_000);
setTimeout(pruneOld, 60_000);

// 6. Синхронизация списка пар с админкой — раз в 60с (добавление/удаление
//    пары применяется без перезапуска коллектора).
const configSyncTimer = setInterval(() => {
  syncSymbolsFromConfig().catch(err => console.error(`[fx/config] fatal: ${err.message}`));
}, 60_000);

// Статус — раз в 10 минут.
setInterval(() => {
  console.log(`[fx/status] WS: ${wsConnected ? "connected" : "disconnected"}, trades=${totalTrades}, TD calls=${totalTwelveDataCalls}`);
}, 600_000);

async function shutdown() {
  console.log("[fx] shutdown…");
  clearInterval(flushTimer);
  clearInterval(fallbackTimer);
  clearInterval(pruneTimer);
  clearInterval(configSyncTimer);
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  if (ws) ws.close();
  await flushLiveCandles().catch(() => {});
  server.close();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
