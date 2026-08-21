// Forex collector — три источника с разными ролями:
//
//   1. Finnhub WebSocket — реальные тики по валютным парам (мажорам).
//   2. Twelve Data REST  — история мажоров при старте + редкий fallback-догон.
//   3. Dukascopy freeserv — готовые свечи по инструментам, которых нет у
//      первых двух (золото XAU/USD), плюс история таймфрейма 1m для всех пар.
//
// Почему так:
//   Twelve Data free tier (800 запросов/день, 8/мин) не тянет обновление
//   каждые 5 минут по всем мажорам × всем таймфреймам — уходит в лимит.
//   Finnhub free tier даёт WebSocket с тиками (сделками) без ограничения на
//   число сообщений (лимитируется только число подписанных символов, до 50) —
//   поэтому коллектор сам агрегирует тики в свечи 1m/5m/15m/1h/4h/1d/1w в
//   памяти и льёт их в Postgres. REST /forex/candle у Finnhub — premium-only
//   на free-плане, поэтому для истории и на случай обрыва WS используется
//   Twelve Data (батчим до 8 символов в одном запросе).
//   Золота (XAU/USD) на free-планах Twelve Data нет (у них это commodity, а не
//   forex), поэтому оно целиком идёт через Dukascopy — там оно бесплатно, без
//   ключа и с многолетней историей на 1m. Подробности — collector/forex/dukascopy.mjs.
//
// Архитектура:
//   Finnhub WS (тики) → агрегатор свечей в памяти → Postgres (FxCandle)
//   Twelve Data REST  → бэкафилл истории мажоров при старте + fallback-догон
//   Dukascopy REST    → свечи по FX_DUKASCOPY_SYMBOLS (опрос) + история 1m всем
//
// ⚠️ exchange="finnhub" у всех строк FxCandle — это ИСТОРИЧЕСКИЙ ТЕГ ОДНОГО
//    ЛОГИЧЕСКОГО РЯДА, а не имя провайдера: под ним лежат и свечи из тиков
//    Finnhub, и бары Twelve Data, и бары Dukascopy (включая золото, которого у
//    Finnhub вообще нет). Приложение фильтрует свечи именно по этому значению
//    (src/app/api/forex/*), поэтому менять его нельзя без миграции данных.
//
// Ограничения free tier:
//   Twelve Data: 8 запросов/мин, 800/день, до 8 символов в одном запросе.
//   Finnhub: WS без лимита на сообщения, до 50 подписанных символов.
//   Dukascopy: ключа нет; лимит не документирован, отвечает 503 при частых
//   запросах — отсюда вежливый темп опроса и ретраи в dukascopy.mjs.

import http from "node:http";
import pg from "pg";
import { fetchCandles as dukasFetchCandles, DUKAS_INTERVAL } from "./dukascopy.mjs";

// ─── Конфигурация из ENV ──────────────────────────────────────────────────

// Ключи из окружения: пустая строка = «не настроен».
//
// Значение, не похожее на ключ, тоже считается ненастроенным — иначе сервис
// уходит подключаться с мусорным токеном и бесконечно ловит обрыв WS, а причина
// («ключ закомментирован в .env») в логе никак не видна. Практический случай:
// ключ, выключенный префиксом //.
function readApiKey(envName) {
  const raw = (process.env[envName] ?? "").trim();
  if (raw === "") return "";
  if (!/^[A-Za-z0-9_-]{8,}$/.test(raw)) {
    console.log(`[fx] ${envName} задан, но не похож на ключ — считаем ненастроенным`);
    return "";
  }
  return raw;
}

const cfg = {
  symbols: (process.env.FX_SYMBOLS ?? "EUR/USD,GBP/USD,USD/JPY,USD/CHF,AUD/USD,NZD/USD,EUR/JPY,GBP/JPY,XAU/USD")
    .split(",").map(s => s.trim()).filter(Boolean),

  // Инструменты, которые собираются из Dukascopy, а не из Finnhub/Twelve Data.
  // Металлов нет ни в WS Finnhub, ни на free-плане Twelve Data, поэтому для
  // них Dukascopy — единственный бесплатный источник (и заодно единственный,
  // который виден из РБ без прокси).
  dukascopySymbols: (process.env.FX_DUKASCOPY_SYMBOLS ?? "XAU/USD,XAG/USD")
    .split(",").map(s => s.trim()).filter(Boolean),

  // Единый тег источника для всех свечей форекса (и WS, и REST-бэкафилл
  // пишут под одним exchange — это один логический ряд для приложения).
  exchange: "finnhub",

  twelveDataApiKey: readApiKey("TWELVEDATA_API_KEY"),
  twelveDataApiBase: process.env.TWELVEDATA_API_BASE ?? "https://api.twelvedata.com",

  finnhubApiKey: readApiKey("FINNHUB_API_KEY"),
  finnhubWsUrl: process.env.FINNHUB_WS_URL ?? "wss://ws.finnhub.io",

  // Как часто Twelve Data досогласовывает историю (fallback-догон), сек.
  // Не критично для реального времени — это только подстраховка на случай
  // обрыва Finnhub WS или пропущенных тиков.
  fallbackIntervalSec: Number(process.env.FX_FALLBACK_INTERVAL_SEC ?? 900),

  // Как часто сбрасывать в БД текущие (ещё открытые) свечи, собранные из тиков.
  flushIntervalSec: Number(process.env.FX_FLUSH_INTERVAL_SEC ?? 15),

  // Базовый шаг опроса Dukascopy. На нём обновляется 1m; более старшие
  // таймфреймы — реже (см. pollDukascopy), чтобы не долбить недокументированный
  // эндпоинт чаще, чем нужно.
  dukascopyPollSec: Number(process.env.FX_DUKASCOPY_POLL_SEC ?? 15),

  candleRetentionDays: Number(process.env.FX_CANDLE_RETENTION_DAYS ?? 365),

  // 1m хранится отдельно и заметно короче: это самый быстрорастущий ряд
  // (1440 свечей в сутки на инструмент против 288 у 5m), а нужен он только
  // для интрадей-разметки. При 365 днях, как у остальных таймфреймов, одна
  // таблица FxCandle съела бы миллионы строк на 8 ГБ сервере.
  m1RetentionDays: Number(process.env.FX_M1_RETENTION_DAYS ?? 30),

  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT ?? 8081),
};

if (!cfg.databaseUrl) {
  console.error("[fx] FATAL: DATABASE_URL не задан");
  process.exit(1);
}

// Ключ Finnhub нужен только для валютных пар: инструменты из
// FX_DUKASCOPY_SYMBOLS (металлы) собираются вообще без ключей.
//
// Отсутствие ключа НЕ фатально, и проверять здесь список пар бессмысленно:
// на этот момент известен только ENV FX_SYMBOLS, а настоящий список приходит
// из FxCollectorConfig уже после старта (syncSymbolsFromConfig). Прежний
// process.exit(1) на этой проверке загонял контейнер в цикл
// «упал — рестарт — упал» даже тогда, когда в БД была настроена пара,
// которую коллектор прекрасно собрал бы без всякого Finnhub.
//
// Чем это грозит вместо падения: валютные пары не обновляются в реальном
// времени. Видно и в логе при старте, и в /health (finnhub.apiKeySet), и в
// /admin/forex по лагу свечей.
if (!cfg.finnhubApiKey) {
  console.error("[fx] ВНИМАНИЕ: FINNHUB_API_KEY не задан — валютные пары не будут обновляться в реальном времени (металлы из FX_DUKASCOPY_SYMBOLS собираются без ключа)");
}

// ─── Postgres ──────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 4 });

// ─── Таймфреймы ───────────────────────────────────────────────────────────

// Наш таймфрейм → интервал Twelve Data. 1m тут намеренно нет: минутку по всем
// парам free-план TD не потянет (8 кредитов/мин, 800/сутки — и они уже уходят
// на остальные таймфреймы), поэтому её историю приносит Dukascopy, а «живую»
// часть — агрегатор тиков Finnhub.
const TF_MAP = {
  "5m": "5min",
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
  "1w": "1week",
};

// Все таймфреймы, которые собирает коллектор (должны совпадать с TF_MS в
// src/app/api/forex/route.ts и RANGES в ForexView.tsx).
const CANDLE_INTERVALS = ["1m", ...Object.keys(TF_MAP)];

const INTERVAL_MS = {
  "1m": 60_000,
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

// Кто обслуживает символ. Металлы (и всё, что перечислено в
// FX_DUKASCOPY_SYMBOLS) идут через Dukascopy и НЕ подписываются на Finnhub и
// не запрашиваются у Twelve Data — там их либо нет, либо они платные.
function isDukascopySymbol(symbol) {
  return cfg.dukascopySymbols.includes(symbol);
}

function finnhubSymbols() {
  return cfg.symbols.filter(s => !isDukascopySymbol(s));
}

function dukascopySymbols() {
  return cfg.symbols.filter(s => isDukascopySymbol(s));
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

async function fetchTimeSeriesBatch(symbols, interval, outputsize, startDate) {
  await rateLimiter.wait(symbols.length);
  const symStr = symbols.join(",");
  // timezone=UTC обязателен: без него Twelve Data отдаёт datetime в своей
  // "биржевой" таймзоне (для форекса — не UTC), и это выглядит как сдвиг
  // свечей в будущее относительно реального времени.
  //
  // start_date — явная нижняя граница глубины истории (см. BACKFILL_DEPTH_DAYS
  // ниже). Без неё Twelve Data просто отдаёт "последние outputsize баров", и
  // непонятно, ограничивает ли реально глубину сам тариф или мы просто плохо
  // просим — с явной датой это видно по ответу (пустая история/ошибка плана
  // логируется явно, см. ниже).
  let url = `${cfg.twelveDataApiBase}/time_series?symbol=${encodeURIComponent(symStr)}&interval=${interval}&outputsize=${outputsize}&timezone=UTC&apikey=${cfg.twelveDataApiKey}`;
  if (startDate) url += `&start_date=${encodeURIComponent(startDate)}`;
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

// Сколько свечей вставляем одним INSERT. Ограничение не наше, а протокола
// Postgres: не больше 65535 bind-параметров на запрос, а у нас 9 параметров на
// строку. Бэкафилл 1m тянет до 20 000 баров за раз — без разбиения на пачки
// весь запрос падал целиком с «bind message has N parameter formats but 0
// parameters», и минутный ряд молча оставался пустым.
const INSERT_CHUNK_ROWS = 5000;

async function storeCandleRows(rows) {
  if (rows.length === 0) return 0;

  let stored = 0;
  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(offset, offset + INSERT_CHUNK_ROWS);
    const values = [];
    const params = [];
    for (const r of chunk) {
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
      stored += chunk.length;
    } catch (err) {
      writeErrors++;
      console.error(`[fx/store] error: ${err.message}`);
    }
  }
  return stored;
}

// Бэкафилл/догон для одного таймфрейма по всем символам разом (батч).
async function fetchAndStoreBatch(interval, outputsize, startDate) {
  const twelveInterval = TF_MAP[interval];
  if (!twelveInterval) return 0;
  if (!cfg.twelveDataApiKey) return 0;

  // Символы Dukascopy (металлы) в батч не попадают: у Twelve Data их нет на
  // free-плане, и каждый такой символ просто съедал бы кредит впустую.
  const symbols = finnhubSymbols();
  if (symbols.length === 0) return 0;

  const requestedMultiple = symbols.length > 1;
  const data = await fetchTimeSeriesBatch(symbols, twelveInterval, outputsize, startDate);
  if (!data) return 0;

  let stored = 0;
  for (const symbol of symbols) {
    const values = extractSymbolValues(data, symbol, requestedMultiple);
    if (!values || values.length === 0) {
      // Явный лог отсутствия данных на символ — если тариф молча режет
      // глубину истории, это будет видно здесь, а не выглядеть как "просто
      // сработал бэкафилл, но почему-то мало свечей".
      if (startDate) console.log(`[fx/td] ${symbol} ${interval}: 0 баров от Twelve Data (запрошено с ${startDate})`);
      continue;
    }
    const rows = values.map(v => toCandleRow(v, symbol, interval));
    stored += await storeCandleRows(rows);
    if (startDate) {
      const oldest = values[values.length - 1]?.datetime;
      const newest = values[0]?.datetime;
      console.log(`[fx/td] ${symbol} ${interval}: получено ${values.length} баров (${oldest} … ${newest}), запрошено с ${startDate}`);
    }
  }
  if (stored > 0) console.log(`[fx/td] ${interval}: +${stored} свечей (${symbols.length} пар за 1 запрос)`);
  return stored;
}

// Насколько глубокая история нужна на каждом таймфрейме (дней назад от
// сегодня). Для 1h/4h/1d/1w просим её ЯВНО через start_date — иначе Twelve
// Data по умолчанию отдаёт "последние outputsize баров", и без явной даты
// невозможно отличить "тариф режет глубину" от "просто мало баров попросили".
// 5m/15m не получают start_date — outputsize=5000 уже даёт ~17–52 дня, для
// внутридневных таймфреймов больше и не нужно (да и Twelve Data столько
// интрадей-истории на free tier обычно и не хранит).
const BACKFILL_DEPTH_DAYS = { "1h": 90, "4h": 180, "1d": 400, "1w": 400 };

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

// На старте: полная история по всем таймфреймам (батчами по символам).
async function backfillAll() {
  if (!forexEnabled) return;
  if (!cfg.twelveDataApiKey) {
    console.log("[fx/td] TWELVEDATA_API_KEY не задан — бэкафилл истории пропущен, ждём накопления тиков из Finnhub");
    backfillDone = true;
    return;
  }
  console.log(`[fx/td] backfill: начинаем для ${finnhubSymbols().length} символов, ${Object.keys(TF_MAP).length} таймфреймов (батч по символам)`);

  for (const interval of CANDLE_INTERVALS) {
    // 1m у Twelve Data не запрашиваем совсем (см. TF_MAP) — им занимается
    // Dukascopy в backfillM1FromDukascopy().
    if (!TF_MAP[interval]) continue;
    const depthDays = BACKFILL_DEPTH_DAYS[interval];
    try {
      // Проверяем ГЛУБИНУ (возраст самой старой свечи), а не count(*) — свечей
      // может быть много (8 символов × сотни баров), но все за последний
      // месяц, если Twelve Data (или сам бэкафилл раньше) ограничил глубину.
      // Старый вариант с count(*) > 100*symbols.length в этом случае навсегда
      // пропускал бы повторный бэкафилл, даже не пытаясь копнуть глубже.
      const r = await pool.query(
        `SELECT MIN("t") as min_t FROM "FxCandle" WHERE "exchange"=$1 AND "interval"=$2`,
        [cfg.exchange, interval],
      );
      const minT = r.rows[0]?.min_t;
      const ageDays = minT ? (Date.now() - new Date(minT).getTime()) / 86_400_000 : 0;
      if (depthDays && ageDays >= depthDays * 0.9) {
        console.log(`[fx/td] backfill: ${interval} — уже есть история глубиной ~${Math.round(ageDays)}д (нужно ${depthDays}д), пропускаем`);
        continue;
      }
      if (!depthDays && minT) {
        console.log(`[fx/td] backfill: ${interval} — данные уже есть, пропускаем`);
        continue;
      }
    } catch (_) {
      // Таблица создастся при первой записи (миграцией) — просто продолжаем.
    }

    // outputsize=5000 — верхняя граница на все таймфреймы: с start_date она
    // просто гарантирует, что весь запрошенный диапазон поместится в ответ
    // (для 1d/400д это 400 баров, для 1h/90д — 2160, оба далеко под 5000).
    const startDate = depthDays ? daysAgoIso(depthDays) : undefined;
    await fetchAndStoreBatch(interval, 5000, startDate);
  }

  backfillDone = true;
  console.log(`[fx/td] backfill: завершён (всего запросов к Twelve Data: ${totalTwelveDataCalls})`);
}

// Периодический fallback-догон: подстраховка, если WS оборвался/пропустил тики.
// Батч по символам, редкий (fallbackIntervalSec) — не расходует лимит впустую.
async function fallbackCatchUp() {
  if (!forexEnabled || !cfg.twelveDataApiKey) return;
  for (const interval of Object.keys(TF_MAP)) {
    const outputsize = interval === "5m" || interval === "15m" ? 20 : 5;
    await fetchAndStoreBatch(interval, outputsize);
  }
  console.log(`[fx/td] fallback-догон завершён (всего запросов: ${totalTwelveDataCalls})`);
}

// Бэкафилл истории для ОДНОГО символа (добавлен из админки после старта) —
// не батчим с остальными, чтобы не пересчитывать общий cfg.symbols на лету.
async function backfillOneSymbol(symbol) {
  if (!forexEnabled) return;
  // Металлы Twelve Data не отдаёт — у них своя история, из Dukascopy.
  if (isDukascopySymbol(symbol)) {
    await backfillDukascopySymbol(symbol);
    return;
  }
  if (!cfg.twelveDataApiKey) return;
  console.log(`[fx/td] backfill нового символа ${symbol}…`);
  for (const interval of CANDLE_INTERVALS) {
    const twelveInterval = TF_MAP[interval];
    if (!twelveInterval) continue;
    const startDate = BACKFILL_DEPTH_DAYS[interval] ? daysAgoIso(BACKFILL_DEPTH_DAYS[interval]) : undefined;
    const data = await fetchTimeSeriesBatch([symbol], twelveInterval, 5000, startDate);
    if (!data) continue;
    const values = extractSymbolValues(data, symbol, false);
    if (!values || values.length === 0) continue;
    const rows = values.map(v => toCandleRow(v, symbol, interval));
    const stored = await storeCandleRows(rows);
    if (stored > 0) console.log(`[fx/td] ${symbol} ${interval}: +${stored} свечей`);
  }
}

// ─── Dukascopy: свечи по металлам + история 1m ────────────────────────────
//
// Здесь берутся ГОТОВЫЕ бары, а не тики: у тиков Dukascopy объём в другой
// шкале, чем у свечей, и смешивать их в одном ряду нельзя (получились бы
// скачки объёма на стыке «история / реальное время»).
//
// 4h собирается агрегацией из 1h, а не запрашивается напрямую: у Dukascopy
// четырёхчасовые бары выровнены по UTC-полуночи, а у нас сетка сдвинута на час
// (bucketStart, наследие Twelve Data). Прямой запрос дал бы для золота другую
// сетку, чем у остальных пар.

let dukasCalls = 0;
let dukasErrors = 0;
let lastDukasOkAt = 0;

// Сколько баров тянем при первом заполнении.
//
// Глубина согласована с retention (FX_CANDLE_RETENTION_DAYS / FX_M1_RETENTION_DAYS):
// просить больше бессмысленно — pruneOld удалит лишнее в ближайший проход, а
// на следующем старте бэкафилл увидит «истории нет» и скачает всё заново. На
// 1d/1w это особенно заметно: Dukascopy отдаёт бары с 2015 года, из которых
// переживает чистку только последний год.
const DUKAS_BACKFILL_LIMIT = { "1m": 20000, "5m": 5000, "15m": 2000, "1h": 5000, "1d": 400, "1w": 60 };

// Достаточная глубина ряда (дней): если самая старая свеча старше — бэкафилл
// пропускаем. Считаем по ВОЗРАСТУ, а не по числу строк: после чистки строк
// всегда меньше, чем было скачано, и проверка по count заставляла бы качать
// историю заново при каждом перезапуске контейнера.
const DUKAS_ENOUGH_DEPTH_DAYS = { "1m": 10, "5m": 12, "15m": 15, "1h": 240, "1d": 330, "1w": 330 };

// Сколько баров просим при периодическом опросе. Больше одного — чтобы
// закрыть возможный пропуск (сеть моргнула, контейнер перезапустился) и
// перезаписать ещё не закрытый бар актуальными значениями.
const DUKAS_POLL_LIMIT = { "1m": 5, "5m": 4, "15m": 3, "1h": 8, "1d": 3, "1w": 2 };

function dukasRowsToCandleRows(symbol, interval, candles) {
  return candles.map(c => ({
    symbol,
    exchange: cfg.exchange,
    interval,
    t: new Date(c.t),
    o: c.o, h: c.h, l: c.l, c: c.c, v: c.v ?? 0,
  }));
}

// Схлопывает свечи меньшего таймфрейма в больший по нашей сетке (bucketStart).
function aggregateToInterval(candles, interval) {
  const buckets = new Map();
  for (const c of [...candles].sort((a, b) => a.t - b.t)) {
    const b = bucketStart(c.t, interval);
    const cur = buckets.get(b);
    if (!cur) {
      buckets.set(b, { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v ?? 0 });
    } else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v += c.v ?? 0;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.t - b.t);
}

// Один запрос к Dukascopy + запись в БД. Ошибку не пробрасываем: недоступность
// Dukascopy не должна ронять сбор по остальным парам.
async function fetchAndStoreDukascopy(symbol, interval, limit) {
  if (!forexEnabled) return 0;
  try {
    dukasCalls++;
    const candles = await dukasFetchCandles(symbol, interval, limit);
    if (candles.length === 0) return 0;
    lastDukasOkAt = Date.now();

    let stored = await storeCandleRows(dukasRowsToCandleRows(symbol, interval, candles));

    // 4h нет у Dukascopy в нашей сетке — собираем его из только что
    // полученных часовых баров тем же запросом, без лишнего обращения к API.
    if (interval === "1h") {
      const h4 = aggregateToInterval(candles, "4h");
      // Первый бакет почти всегда неполный (окно запроса началось в его
      // середине) — он затёр бы корректный бар в БД частичными O/H/L/V.
      const complete = h4.slice(1);
      if (complete.length > 0) stored += await storeCandleRows(dukasRowsToCandleRows(symbol, "4h", complete));
    }
    return stored;
  } catch (err) {
    dukasErrors++;
    console.error(`[fx/dukas] ${symbol} ${interval}: ${err.message}`);
    return 0;
  }
}

// Достраивает ТЕКУЩИЙ (ещё не закрытый) бар старшего таймфрейма из минуток,
// уже лежащих в БД.
//
// Зачем: Dukascopy отдаёт по 1HOUR/1DAY/1WEEK только ЗАКРЫТЫЕ бары — текущего
// часа в ответе просто нет (проверено: в 20:43 UTC последний часовой бар был
// 19:00). Без этой достройки дневная свеча золота появлялась бы на графике
// только назавтра, а часовая — в начале следующего часа.
//
// Считает Postgres: это один индексный range-scan и одна строка в ответ,
// дешевле, чем тащить минутки в Node и складывать их там.
async function refreshFormingBucket(symbol, interval) {
  const span = INTERVAL_MS[interval];
  if (!span) return 0;
  const from = bucketStart(Date.now(), interval);
  const to = from + span;

  try {
    const r = await pool.query(
      `SELECT (array_agg("o" ORDER BY "t"))[1] AS o,
              MAX("h") AS h,
              MIN("l") AS l,
              (array_agg("c" ORDER BY "t" DESC))[1] AS c,
              SUM("v") AS v,
              COUNT(*)::int AS n
         FROM "FxCandle"
        WHERE "symbol"=$1 AND "exchange"=$2 AND "interval"='1m' AND "t" >= $3 AND "t" < $4`,
      [symbol, cfg.exchange, new Date(from), new Date(to)],
    );
    const row = r.rows[0];
    if (!row || row.n === 0) return 0;
    return await storeCandleRows([{
      symbol,
      exchange: cfg.exchange,
      interval,
      t: new Date(from),
      o: Number(row.o), h: Number(row.h), l: Number(row.l), c: Number(row.c), v: Number(row.v ?? 0),
    }]);
  } catch (err) {
    console.error(`[fx/dukas] достройка ${symbol} ${interval}: ${err.message}`);
    return 0;
  }
}

// Есть ли уже в БД история нужной глубины (чтобы не тянуть её при каждом
// перезапуске контейнера).
async function hasHistoryDepth(symbol, interval, depthDays) {
  try {
    const r = await pool.query(
      `SELECT MIN("t") AS min_t FROM "FxCandle" WHERE "symbol"=$1 AND "exchange"=$2 AND "interval"=$3`,
      [symbol, cfg.exchange, interval],
    );
    const minT = r.rows[0]?.min_t;
    if (!minT) return false;
    return (Date.now() - new Date(minT).getTime()) / 86_400_000 >= depthDays;
  } catch {
    return false; // таблицы ещё нет — считаем, что истории нет
  }
}

// Полный бэкафилл одного инструмента Dukascopy (все таймфреймы).
async function backfillDukascopySymbol(symbol) {
  console.log(`[fx/dukas] backfill ${symbol}…`);
  for (const interval of Object.keys(DUKAS_INTERVAL)) {
    const limit = DUKAS_BACKFILL_LIMIT[interval] ?? 1000;
    const depthDays = DUKAS_ENOUGH_DEPTH_DAYS[interval] ?? 1;
    if (await hasHistoryDepth(symbol, interval, depthDays)) {
      console.log(`[fx/dukas] ${symbol} ${interval}: история глубже ${depthDays}д уже есть, пропускаем`);
      continue;
    }
    const stored = await fetchAndStoreDukascopy(symbol, interval, limit);
    if (stored > 0) console.log(`[fx/dukas] ${symbol} ${interval}: +${stored} свечей`);
    // Вежливая пауза: эндпоинт недокументированный, на пачке частых запросов
    // он отвечает 503.
    await new Promise(r => setTimeout(r, 1500));
  }

  // Сразу после бэкафилла достраиваем текущие бары старших таймфреймов —
  // иначе до первого срабатывания их тика в pollDukascopy график показывал бы
  // историю без «сегодня».
  for (const interval of ["5m", "15m", "1h", "4h", "1d", "1w"]) {
    await refreshFormingBucket(symbol, interval);
  }
}

// История 1m для пар, которые в реальном времени идут через Finnhub. Без неё
// новый таймфрейм был бы пустым до тех пор, пока не накопятся тики.
async function backfillM1ForFinnhubSymbols() {
  for (const symbol of finnhubSymbols()) {
    // 3 дня (~5000 минуток торговли) — этого хватает, чтобы таймфрейм открылся
    // не пустым; дальше ряд наращивают тики Finnhub.
    if (await hasHistoryDepth(symbol, "1m", 3)) continue;
    const stored = await fetchAndStoreDukascopy(symbol, "1m", 5000);
    if (stored > 0) console.log(`[fx/dukas] ${symbol} 1m: +${stored} свечей (история)`);
    await new Promise(r => setTimeout(r, 1500));
  }
}

async function backfillDukascopyAll() {
  if (!forexEnabled) return;
  for (const symbol of dukascopySymbols()) {
    await backfillDukascopySymbol(symbol);
  }
  await backfillM1ForFinnhubSymbols();
  console.log(`[fx/dukas] backfill завершён (запросов: ${dukasCalls}, ошибок: ${dukasErrors})`);
}

// Периодический опрос. Тики Dukascopy отдаёт с задержкой 0.5–3с, но нам нужны
// свечи, поэтому «живость» определяется шагом опроса: 1m обновляется каждые
// dukascopyPollSec, старшие таймфреймы — кратно реже (им чаще и не нужно).
let dukasPollTick = 0;

async function pollDukascopy() {
  if (!forexEnabled) return;
  const symbols = dukascopySymbols();
  if (symbols.length === 0) return;

  const n = dukasPollTick++;
  const stepsPerMinute = Math.max(1, Math.round(60 / cfg.dukascopyPollSec));

  // Что тянем из Dukascopy (закрытые бары — они точные и дают глубину).
  const fetchIntervals = ["1m"];
  if (n % stepsPerMinute === 0) fetchIntervals.push("5m", "15m");
  if (n % (stepsPerMinute * 5) === 0) fetchIntervals.push("1h"); // + 4h агрегацией
  if (n % (stepsPerMinute * 15) === 0) fetchIntervals.push("1d", "1w");

  // Что достраиваем из минуток (текущий незакрытый бар — его Dukascopy не
  // отдаёт). Младшие — каждый тик, старшие — реже: чем больше бакет, тем
  // больше минуток приходится сканировать, а меняется он не так заметно.
  const formingIntervals = ["5m", "15m"];
  if (n % stepsPerMinute === 0) formingIntervals.push("1h", "4h");
  if (n % (stepsPerMinute * 5) === 0) formingIntervals.push("1d", "1w");

  for (const symbol of symbols) {
    for (const interval of fetchIntervals) {
      await fetchAndStoreDukascopy(symbol, interval, DUKAS_POLL_LIMIT[interval] ?? 3);
    }
    for (const interval of formingIntervals) {
      await refreshFormingBucket(symbol, interval);
    }
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
  if (!forexEnabled) return;
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
  if (!forexEnabled) return;
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
let wsOpenedAt = 0;
// Сеть до Finnhub нестабильна на некоторых хостах (code=1006, обрыв без
// close-фрейма — похоже на NAT/файрвол, обрывающий соединение, а не отказ
// самого Finnhub). Раньше задержка реконнекта сбрасывалась на минимум при
// КАЖДОМ открытии соединения — если оно обрывалось почти сразу, получался
// частый цикл переподключений, который ещё сильнее нагружал нестабильный
// путь. Теперь сбрасываем задержку только если соединение продержалось
// стабильно — иначе продолжаем расти по экспоненте.
const WS_STABLE_MS = 30_000;

function connectFinnhub() {
  if (!forexEnabled) return;
  if (!cfg.finnhubApiKey) return; // конфигурация «только Dukascopy» — подключаться некуда
  if (finnhubSymbols().length === 0) {
    console.log("[fx/ws] валютных пар в списке нет — Finnhub не нужен");
    return;
  }
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
    wsOpenedAt = Date.now();
    const symbols = finnhubSymbols();
    console.log(`[fx/ws] подключено, подписываемся на ${symbols.length} пар`);
    for (const symbol of symbols) {
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
    // Сбрасываем задержку реконнекта на минимум, только если соединение
    // продержалось достаточно долго (WS_STABLE_MS) — иначе при частых
    // мгновенных обрывах (нестабильная сеть) продолжаем расти по экспоненте,
    // а не долбим заново каждые 2с.
    const heldMs = wsOpenedAt ? Date.now() - wsOpenedAt : 0;
    if (heldMs >= WS_STABLE_MS) wsReconnectDelayMs = 2000;
    // code/reason из close-фрейма — часто это единственный способ понять
    // причину (неверный токен, лимит, сетевой обрыв и т.п.), т.к. onerror
    // сам по себе редко несёт полезную информацию.
    console.log(`[fx/ws] соединение закрыто (code=${event?.code ?? "?"} reason="${event?.reason ?? ""}", держалось ${Math.round(heldMs / 1000)}с), переподключение через ${wsReconnectDelayMs}мс`);
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (!forexEnabled || wsReconnectTimer) return;
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
      `DELETE FROM "FxCandle"
        WHERE "exchange"=$1 AND "interval" <> '1m' AND "t" < NOW() - ($2 || ' days')::interval`,
      [cfg.exchange, String(cfg.candleRetentionDays)],
    );
    if (r.rowCount > 0) console.log(`[fx/prune] FxCandle: удалено ${r.rowCount} строк`);
  } catch (err) {
    console.error(`[fx/prune] FxCandle: ${err.message}`);
  }

  // 1m — отдельным запросом и с более коротким сроком: ряд растёт в 5 раз
  // быстрее 5m, а глубже месяца минутка на графике не нужна.
  try {
    const r = await pool.query(
      `DELETE FROM "FxCandle"
        WHERE "exchange"=$1 AND "interval"='1m' AND "t" < NOW() - ($2 || ' days')::interval`,
      [cfg.exchange, String(cfg.m1RetentionDays)],
    );
    if (r.rowCount > 0) console.log(`[fx/prune] FxCandle 1m: удалено ${r.rowCount} строк`);
  } catch (err) {
    console.error(`[fx/prune] FxCandle 1m: ${err.message}`);
  }
}

// ─── Список пар из админки (FxCollectorConfig) ────────────────────────────
//
// Источник истины — таблица FxCollectorConfig (управляется из админки без
// передеплоя). Если она пуста (свежий деплой, ничего ещё не настроено) —
// используем ENV FX_SYMBOLS как фоллбек-дефолт.

const envDefaultSymbols = [...cfg.symbols];

// Первая синхронизация с БД происходит ДО общего бэкафилла в start(). Если
// список в FxCollectorConfig отличается от ENV FX_SYMBOLS (обычное дело —
// пары настраивают в админке), она видит все пары как «добавленные» и тянет
// историю по каждой, а следом то же самое делает общий бэкафилл. Второй
// проход безвреден (проверка глубины его отсекает), но на пустой БД это
// двойной расход запросов — а кредиты Twelve Data и так в дефиците.
let initialSyncDone = false;

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
    // Металлы на Finnhub не подписаны — отписываться не от чего.
    if (wsConnected && ws && !isDukascopySymbol(symbol)) {
      try { ws.send(JSON.stringify({ type: "unsubscribe", symbol: toFinnhubSymbol(symbol) })); } catch { /* noop */ }
    }
    liveCandles.delete(symbol);
  }

  cfg.symbols.length = 0;
  cfg.symbols.push(...target);

  for (const symbol of added) {
    if (wsConnected && ws && !isDukascopySymbol(symbol)) {
      try { ws.send(JSON.stringify({ type: "subscribe", symbol: toFinnhubSymbol(symbol) })); } catch { /* noop */ }
    }
    // На старте историю тянет общий бэкафилл — здесь только пары, добавленные
    // из админки в уже работающем коллекторе.
    if (!initialSyncDone) continue;
    backfillOneSymbol(symbol).catch(err => console.error(`[fx/config] backfill ${symbol}: ${err.message}`));
  }
}

// ─── Общий выключатель «Форекс» (FeatureConfig, /admin/features) ──────────
//
// Тот же переключатель, что видит приложение (src/lib/features.ts, ключ
// "forex"). Полное отключение раздела в админке должно останавливать и
// сбор данных — иначе коллектор продолжал бы бесполезно писать в БД, пока
// раздел скрыт от всех. Нет строки в таблице — считаем включённым (тот же
// дефолт, что и в getFeatureConfig на стороне приложения).

let forexEnabled = true;

async function checkForexEnabled() {
  try {
    const r = await pool.query(`SELECT enabled FROM "FeatureConfig" WHERE key = 'forex'`);
    const next = r.rows.length === 0 ? true : !!r.rows[0].enabled;
    if (next === forexEnabled) return;

    forexEnabled = next;
    if (!forexEnabled) {
      console.log(`[fx/toggle] раздел "Форекс" выключен в админке — останавливаем сбор данных`);
      if (ws) { try { ws.close(); } catch { /* noop */ } }
      if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    } else {
      console.log(`[fx/toggle] раздел "Форекс" снова включён — возобновляем сбор данных`);
      connectFinnhub();
    }
  } catch (err) {
    console.error(`[fx/toggle] ошибка чтения FeatureConfig: ${err.message}`);
  }
}

// ─── HTTP healthcheck ────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = (req.url ?? "").split("?")[0];
  if (url === "/health" || url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      healthy: !forexEnabled || wsConnected || backfillDone,
      forexEnabled,
      uptimeMs: Date.now() - startedAt,
      instruments: cfg.symbols.length,
      symbols: cfg.symbols,
      backfillDone,
      ws: {
        apiKeySet: cfg.finnhubApiKey.length > 0,
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
      dukascopy: {
        symbols: dukascopySymbols(),
        pollSec: cfg.dukascopyPollSec,
        totalCalls: dukasCalls,
        errors: dukasErrors,
        lastOkAt: lastDukasOkAt ? new Date(lastDukasOkAt).toISOString() : null,
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
  // -1. Общий выключатель «Форекс» из /admin/features — если раздел выключен
  //     ещё до старта, сразу переходим в режим паузы (ничего не подключаем,
  //     ничего не пишем), пока его не включат обратно.
  await checkForexEnabled();

  // 0. Список пар из админки (FxCollectorConfig), если настроен — иначе
  //    остаётся дефолт из ENV FX_SYMBOLS (envDefaultSymbols).
  await syncSymbolsFromConfig();
  initialSyncDone = true;

  console.log(`[fx/start] symbols=${cfg.symbols.join(",")} exchange=${cfg.exchange} forexEnabled=${forexEnabled}`);
  // Список пар только что пришёл из БД — теперь видно, что реально соберётся.
  const dukas = dukascopySymbols();
  const viaFinnhub = finnhubSymbols();
  console.log(`[fx/start] Dukascopy: ${dukas.length ? dukas.join(",") : "—"} | Finnhub: ${viaFinnhub.length ? viaFinnhub.join(",") : "—"}${!cfg.finnhubApiKey && viaFinnhub.length ? " (без ключа — только история)" : ""}`);

  // 1. Бэкафилл истории через Twelve Data (если задан ключ).
  backfillAll().catch(err => console.error(`[fx/backfill] fatal: ${err.message}`));

  // 2. Бэкафилл через Dukascopy: металлы целиком + история 1m для всех пар.
  //    Отдельной цепочкой от Twelve Data — они не мешают друг другу и не
  //    делят лимиты.
  backfillDukascopyAll().catch(err => console.error(`[fx/dukas] fatal: ${err.message}`));

  // 3. Основной источник реального времени — Finnhub WS.
  connectFinnhub();
}
start().catch(err => console.error(`[fx/start] fatal: ${err.message}`));

// 3. Периодический сброс агрегированных из тиков свечей в БД.
const flushTimer = setInterval(() => {
  flushLiveCandles().catch(err => console.error(`[fx/flush] fatal: ${err.message}`));
}, cfg.flushIntervalSec * 1000);

// 3.1. Опрос Dukascopy — «живые» свечи по металлам.
const dukascopyTimer = setInterval(() => {
  pollDukascopy().catch(err => console.error(`[fx/dukas] fatal: ${err.message}`));
}, cfg.dukascopyPollSec * 1000);

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

// 7. Общий выключатель «Форекс» (/admin/features) — тоже раз в 60с, отдельным
//    таймером: включение/выключение должно применяться быстро и независимо
//    от того, успела ли отработать синхронизация списка пар.
const toggleTimer = setInterval(() => {
  checkForexEnabled().catch(err => console.error(`[fx/toggle] fatal: ${err.message}`));
}, 60_000);

// Статус — раз в 10 минут.
setInterval(() => {
  console.log(`[fx/status] WS: ${wsConnected ? "connected" : "disconnected"}, trades=${totalTrades}, TD calls=${totalTwelveDataCalls}, Dukascopy calls=${dukasCalls} (ошибок ${dukasErrors})`);
}, 600_000);

async function shutdown() {
  console.log("[fx] shutdown…");
  clearInterval(flushTimer);
  clearInterval(dukascopyTimer);
  clearInterval(fallbackTimer);
  clearInterval(pruneTimer);
  clearInterval(configSyncTimer);
  clearInterval(toggleTimer);
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  if (ws) ws.close();
  await flushLiveCandles().catch(() => {});
  server.close();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
