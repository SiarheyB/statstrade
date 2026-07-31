// Forex collector — подключается к Twelve Data REST API и пишет свечи + котировки в Postgres.
//
// Замена Dukascopy bridge: он не доступен из РБ.
// Twelve Data — бесплатный REST API (800 запросов/день, 8 запросов/мин).
// Даёт OHLCV свечи + bid/ask котировки для всех мажоров и кроссов.
// Нет данных стакана (depth) — индикаторы работают через свечи и котировки.
//
// Архитектура:
//   Twelve Data REST API → этот collector → Postgres (FxCandle + FxQuote)
//
// Ограничения free tier:
//   - 8 запросов в минуту
//   - 800 запросов в день
//   - До 8 символов в одном запросе (через запятую)
//   - Исторические данные: до 5000 свечей за запрос

import http from "node:http";
import pg from "pg";

// ─── Конфигурация из ENV ──────────────────────────────────────────────────

const cfg = {
  symbols: (process.env.FX_SYMBOLS ?? "EUR/USD,GBP/USD,USD/JPY,USD/CHF,AUD/USD,NZD/USD,EUR/JPY,GBP/JPY")
    .split(",").map(s => s.trim()).filter(Boolean),

  exchange: "twelvedata",

  // Twelve Data API key.
  apiKey: process.env.TWELVEDATA_API_KEY ?? "",

  // URL для запросов к Twelve Data (без символа в конце).
  apiBase: process.env.TWELVEDATA_API_BASE ?? "https://api.twelvedata.com",

  // Как часто обновлять свечи (с) — 600 секунд, чтобы цикл из 36 запросов
  // (6 символов × 6 таймфреймов) успевал при rate limit 10 сек/запрос.
  updateIntervalSec: Number(process.env.FX_UPDATE_INTERVAL_SEC ?? 600),

  // Сколько дней хранить свечи.
  candleRetentionDays: Number(process.env.FX_CANDLE_RETENTION_DAYS ?? 365),

  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT ?? 8081),
};

if (!cfg.databaseUrl) {
  console.error("[fx] FATAL: DATABASE_URL не задан");
  process.exit(1);
}

if (!cfg.apiKey) {
  console.error("[fx] FATAL: TWELVEDATA_API_KEY не задан");
  process.exit(1);
}

// ─── Postgres ──────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 4 });

// ─── Таймфреймы ───────────────────────────────────────────────────────────

// Маппинг нашего таймфрейма → интервал Twelve Data.
// Twelve Data не поддерживает 12h — исключаем из коллектора.
const TF_MAP = {
  "5m": "5min",
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
  "1w": "1week",
};

const CANDLE_INTERVALS = Object.keys(TF_MAP);

// ─── Rate limiter ──────────────────────────────────────────────────────────
//
// Twelve Data free tier: 8 запросов/мин, 800/день.
// Простая очередь: не более 1 запроса в 8 секунд (≈7.5/мин).

class RateLimiter {
  constructor(minIntervalMs = 8000) {
    this._minInterval = minIntervalMs;
    this._lastCall = 0;
  }

  async wait() {
    const now = Date.now();
    const wait = Math.max(0, this._lastCall + this._minInterval - now);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this._lastCall = Date.now();
  }
}

const rateLimiter = new RateLimiter(10000);

// ─── Состояние коллектора ─────────────────────────────────────────────────

const startedAt = Date.now();
let writeErrors = 0;
let lastWriteOkAt = 0;
let totalApiCalls = 0;
let backfillDone = false;

// ─── Twelve Data API ──────────────────────────────────────────────────────

// Запрос к Twelve Data time_series.
// Поддерживает несколько символов через запятую.
async function fetchTimeSeries(symbols, interval, outputsize = 5000) {
  await rateLimiter.wait();
  const symStr = symbols.join(",");
  const url = `${cfg.apiBase}/time_series?symbol=${encodeURIComponent(symStr)}&interval=${interval}&outputsize=${outputsize}&apikey=${cfg.apiKey}`;
  totalApiCalls++;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[fx/api] HTTP ${res.status} для ${symStr} ${interval}: ${text.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    if (data.status === "error") {
      console.error(`[fx/api] Twelve Data error: ${data.message ?? JSON.stringify(data)}`);
      return null;
    }
    return data;
  } catch (err) {
    console.error(`[fx/api] fetch error ${symStr} ${interval}: ${err.message}`);
    return null;
  }
}

// ─── Парсинг свечей из ответа Twelve Data ──────────────────────────────────
//
// Ответ Twelve Data time_series:
// {
//   "status": "ok",
//   "values": [{ "datetime": "2024-01-01 00:00:00", "open": "1.07000", "high": "1.07050", "low": "1.06950", "close": "1.07000", "volume": "1234" }]
// }

function parseTwelveDataResponse(data, symbol) {
  if (!data || data.status !== "ok") return null;
  // Если запрошен один символ — values прямо в ответе.
  // Если несколько — ответ в виде { "EUR/USD": { "status": "ok", "values": [...] }, ... }
  let values;
  if (data.values) {
    values = data.values;
  } else if (data[symbol]) {
    values = data[symbol].values;
  } else {
    // Ищем первый символ с данными
    for (const key of Object.keys(data)) {
      if (data[key]?.values) {
        values = data[key].values;
        break;
      }
    }
  }
  if (!Array.isArray(values) || values.length === 0) return null;
  return values;
}

// Конвертация свечи Twelve Data → наш формат.
function toCandleRow(value, symbol, interval) {
  const dt = value.datetime;
  // Формат даты: "2024-01-01 00:00:00" (intraday) или "2024-01-01" (daily)
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

// ─── Запись свечей в БД ──────────────────────────────────────────────────

async function storeCandles(rows, symbol, interval) {
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
    console.error(`[fx/store] error ${symbol} ${interval}: ${err.message}`);
    return 0;
  }
}

// ─── Получение и сохранение свечей для пары ───────────────────────────────

async function fetchAndStoreForSymbol(symbol, interval, outputsize = 1000) {
  const twelveInterval = TF_MAP[interval];
  if (!twelveInterval) return 0;

  const data = await fetchTimeSeries([symbol], twelveInterval, outputsize);
  if (!data) return 0;

  const values = parseTwelveDataResponse(data, symbol);
  if (!values) return 0;

  const rows = values.map(v => toCandleRow(v, symbol, interval));
  const stored = await storeCandles(rows, symbol, interval);
  if (stored > 0) {
    console.log(`[fx] ${symbol} ${interval}: +${stored} свечей`);
  }
  return stored;
}

// ─── Бэкафилл исторических данных ─────────────────────────────────────────
//
// На старте: загружаем историю для всех символов × всех таймфреймов.
// Используем outputsize=5000 для максимальной истории.

async function backfillAll() {
  console.log(`[fx] backfill: начинаем для ${cfg.symbols.length} символов, ${CANDLE_INTERVALS.length} таймфреймов`);

  for (const symbol of cfg.symbols) {
    for (const interval of CANDLE_INTERVALS) {
      // Проверяем, есть ли уже данные в БД
      try {
        const r = await pool.query(
          `SELECT COUNT(*) as cnt FROM "FxCandle" WHERE "symbol"=$1 AND "exchange"=$2 AND "interval"=$3`,
          [symbol, cfg.exchange, interval],
        );
        if (parseInt(r.rows[0]?.cnt ?? "0") > 100) {
          console.log(`[fx] backfill: ${symbol} ${interval} — уже есть данные, пропускаем`);
          continue;
        }
      } catch (_) {
        // Если таблица не существует — создастся при первой записи
      }

      const outputsize = interval === "5m" || interval === "15m" ? 5000 : 2000;
      await fetchAndStoreForSymbol(symbol, interval, outputsize);
    }
  }

  backfillDone = true;
  console.log(`[fx] backfill: завершён (всего API вызовов: ${totalApiCalls})`);
}

// ─── Периодическое обновление ─────────────────────────────────────────────
//
// Раз в updateIntervalSec: обновляем последние свечи для ВСЕХ символов × ВСЕХ
// таймфреймов. Каждый таймфрейм получает достаточно свечей для отображения:
//   - 5m/15m: 100 свечей (быстрые)
//   - 1h/4h: 10 свечей
//   - 1d/1w: 5 свечей

async function updateLatest() {
  for (const symbol of cfg.symbols) {
    const intervals = [
      { interval: "5m", outputsize: 100 },
      { interval: "15m", outputsize: 100 },
      { interval: "1h", outputsize: 10 },
      { interval: "4h", outputsize: 10 },
      { interval: "1d", outputsize: 5 },
      { interval: "1w", outputsize: 5 },
    ];
    for (const { interval, outputsize } of intervals) {
      await fetchAndStoreForSymbol(symbol, interval, outputsize);
    }
  }
  console.log(`[fx] update: завершён (всего API вызовов: ${totalApiCalls})`);
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

// ─── HTTP healthcheck ────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = (req.url ?? "").split("?")[0];
  if (url === "/health" || url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      healthy: cfg.apiKey.length > 0,
      uptimeMs: Date.now() - startedAt,
      instruments: cfg.symbols.length,
      backfillDone,
      totalApiCalls,
      errors: writeErrors,
      lastWriteOkAt: lastWriteOkAt ? new Date(lastWriteOkAt).toISOString() : null,
      apiKeySet: cfg.apiKey.length > 0,
      updateIntervalSec: cfg.updateIntervalSec,
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

console.log(`[fx/start] symbols=${cfg.symbols.join(",")} exchange=${cfg.exchange} update=${cfg.updateIntervalSec}s`);

// Бэкафилл при старте
backfillAll().catch(err => console.error(`[fx/backfill] fatal: ${err.message}`));

// Периодическое обновление свечей
const updateTimer = setInterval(() => {
  updateLatest().catch(err => console.error(`[fx/update] fatal: ${err.message}`));
}, cfg.updateIntervalSec * 1000);


// Чистка — раз в 6 часов
const pruneTimer = setInterval(pruneOld, 6 * 3600_000);
setTimeout(pruneOld, 60_000);

// Статус rate limit — выводим каждые 10 минут
setInterval(() => {
  console.log(`[fx/status] API calls: ${totalApiCalls}, backfill: ${backfillDone ? "✅" : "⏳"}`);
}, 600_000);

async function shutdown() {
  console.log("[fx] shutdown…");
  clearInterval(updateTimer);
  clearInterval(pruneTimer);
  server.close();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);