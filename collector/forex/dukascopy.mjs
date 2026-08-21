// Клиент к бесплатному фиду Dukascopy (freeserv) — источник свечей и тиков
// для инструментов, которых нет у Finnhub/Twelve Data (в первую очередь
// XAU/USD — золото).
//
// Почему именно он:
//   • отдаёт 1-минутные свечи и тики без API-ключа и без регистрации;
//   • виден с белорусского IP — проверено на прод-сервере (из РБ недоступен
//     именно JForex/демо-счёт, на который был расчёт изначально, см. FOREX_PLAN.md);
//   • глубина архива на 1MIN — годы (проверено на данных 2023 года), до
//     20 000 баров за один запрос;
//   • тики приходят с задержкой 0.5–3 с, то есть годятся и для «живого» графика.
//
// ⚠️ Заголовки User-Agent и Referer ОБЯЗАТЕЛЬНЫ. Без них сервис отвечает
//    HTTP 200 с пустым телом — это выглядит как блокировка по гео, хотя на
//    самом деле просто отсекается «неродной» клиент.
//
// ⚠️ Эндпоинт недокументированный (это бэкенд их встраиваемых виджетов).
//    Поэтому: вежливый темп опроса, ретраи на 5xx и обязательный фоллбек в
//    вызывающем коде — если Dukascopy отвалится, коллектор должен продолжать
//    работать по остальным парам.

const BASE_URL = "https://freeserv.dukascopy.com/2.0/index.php";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Referer: "https://freeserv.dukascopy.com/",
  Accept: "*/*",
};

// Наш таймфрейм → интервал Dukascopy. 4h намеренно отсутствует: у Dukascopy
// четырёхчасовые бары выровнены по UTC-полуночи (00/04/08…), а у нас — со
// сдвигом в час (01/05/09…, см. bucketStart в index.mjs, унаследовано от
// Twelve Data). Чтобы сетка не разъезжалась, 4h собирается агрегацией из 1h.
export const DUKAS_INTERVAL = {
  "1m": "1MIN",
  "5m": "5MIN",
  "15m": "15MIN",
  "1h": "1HOUR",
  "1d": "1DAY",
  "1w": "1WEEK",
};

export class DukascopyError extends Error {}

function buildUrl(params) {
  const qs = new URLSearchParams(params).toString();
  return `${BASE_URL}?${qs}`;
}

// Ответ приходит в формате JSONP: `cb([[…],[…]]);`
function parseJsonp(body) {
  const start = body.indexOf("(");
  const end = body.lastIndexOf(")");
  if (start < 0 || end <= start) {
    throw new DukascopyError(`неожиданный ответ: ${body.slice(0, 120)}`);
  }
  return JSON.parse(body.slice(start + 1, end));
}

// Ошибка, которую нет смысла повторять (проблема запроса, а не сети).
class FatalDukascopyError extends DukascopyError {}

async function request(params, { retries = 2, timeoutMs = 20_000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // Dukascopy отвечает 503 при слишком частых запросах и «отпускает»
      // через несколько секунд — растущая пауза, а не мгновенный ретрай.
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
    try {
      const res = await fetch(buildUrl(params), {
        headers: HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastErr = new DukascopyError(`HTTP ${res.status}`);
        continue;
      }
      const body = await res.text();
      if (body.trim().length === 0) {
        // Пустое тело при HTTP 200 — это «съеденные» заголовки (см.
        // предупреждение выше), то есть ошибка конфигурации, а не сбой сети.
        // Ретраить её бессмысленно: ответ будет ровно тот же, а опрос встанет
        // на все паузы бэкоффа. Падаем сразу и с подсказкой в тексте.
        throw new FatalDukascopyError("пустой ответ (проверьте User-Agent/Referer)");
      }
      return parseJsonp(body);
    } catch (err) {
      if (err instanceof FatalDukascopyError) throw err;
      lastErr = err;
    }
  }
  throw lastErr ?? new DukascopyError("неизвестная ошибка");
}

/**
 * Свечи по инструменту.
 *
 * @param {string} instrument  "XAU/USD" — формат тот же, что у нас в FX_SYMBOLS
 * @param {string} interval    ключ DUKAS_INTERVAL ("1m", "5m", …)
 * @param {number} limit       сколько баров вернуть (до 20 000 на 1m)
 * @param {number} [timestampMs] правая граница окна; по умолчанию — сейчас
 * @returns {Promise<Array<{t:number,o:number,h:number,l:number,c:number,v:number}>>}
 *          по возрастанию времени; самый свежий бар — ещё формирующийся
 */
export async function fetchCandles(instrument, interval, limit, timestampMs = Date.now()) {
  const dukasInterval = DUKAS_INTERVAL[interval];
  if (!dukasInterval) throw new DukascopyError(`интервал ${interval} не поддерживается`);

  const rows = await request({
    path: "chart/json3",
    instrument,
    offer_side: "B", // bid — та же сторона, что показывает график Dukascopy
    interval: dukasInterval,
    limit: String(limit),
    time_direction: "P", // P = в прошлое от timestamp
    timestamp: String(timestampMs),
    jsonp: "cb",
  });

  if (!Array.isArray(rows)) return [];
  return rows
    .filter(r => Array.isArray(r) && r.length >= 5 && Number.isFinite(r[0]))
    .map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] ?? 0 }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Последние тики (bid/ask с объёмами).
 *
 * Сейчас используется только для healthcheck-диагностики: свечи берём
 * готовыми, потому что у них корректные объёмы в единицах Dukascopy, а у
 * тиков объём в другой шкале — смешивать их в одном ряду нельзя.
 *
 * @returns {Promise<Array<{t:number,bid:number,ask:number,bidVol:number,askVol:number}>>}
 */
export async function fetchTicks(instrument, limit = 1, timestampMs = Date.now()) {
  const rows = await request({
    path: "chart/json3",
    instrument,
    offer_side: "B",
    interval: "TICK",
    limit: String(limit),
    time_direction: "P",
    timestamp: String(timestampMs),
    jsonp: "cb",
  });
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(r => Array.isArray(r) && r.length >= 3 && Number.isFinite(r[0]))
    .map(r => ({ t: r[0], bid: r[1], ask: r[2], bidVol: r[3] ?? 0, askVol: r[4] ?? 0 }))
    .sort((a, b) => a.t - b.t);
}
