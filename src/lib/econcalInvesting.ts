import { parse } from "node-html-parser";
import { spawn } from "child_process";

/**
 * Экономический календарь с ru.investing.com.
 *
 * Зачем второй источник рядом с ForexFactory: важность события пользователи
 * сверяют именно с investing, а бесплатный фид faireconomy метит её заметно
 * иначе — настолько, что под ForexFactory пришлось вести РУЧНУЮ таблицу
 * соответствия (src/lib/econcalImpact.ts). Здесь звёзды приходят из самого
 * investing, и таблица этому источнику не нужна вовсе.
 *
 * Второй выигрыш — язык: investing отдаёт названия событий по-русски, то есть
 * ровно так, как они выглядят у пользователя на сайте, без словаря переводов.
 *
 * Официального API у календаря нет. Берём тот же XHR-эндпоинт, которым
 * пользуется сама страница календаря при прокрутке и смене фильтров.
 */

// Эндпоинт страницы календаря. ru-поддомен обязателен: у русской и английской
// версий РАЗНАЯ оценка важности одного события (новозеландский торговый баланс:
// ru — две звезды, en — одна), а пользователи смотрят русскую (см. CLAUDE.md).
const ENDPOINT = "https://ru.investing.com/economic-calendar/Service/getCalendarFilteredData";

// Заголовки подобраны опытом, и набор здесь ТОЧНЫЙ — лишний столь же вреден,
// сколь недостающий:
//   • X-Requested-With отличает «свой» XHR от захода в адресную строку, без
//     него и без Referer эндпоинт отвечает пустотой;
//   • Accept НЕ ставим намеренно. Казалось бы, «application/json,
//     text/javascript» — ровно то, что шлёт сама страница календаря. Но именно
//     с ним Cloudflare выдаёт заглушку «Just a moment…», а без него тот же
//     запрос возвращает 497 КБ разметки (проверено перебором: отличие ровно в
//     этом заголовке). Не добавляйте его «для порядка».
const HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "x-requested-with": "XMLHttpRequest",
  "content-type": "application/x-www-form-urlencoded",
  referer: "https://ru.investing.com/economic-calendar/",
  "accept-language": "ru-RU,ru;q=0.9",
};

/**
 * Внутренние id стран у investing. Отбор по ним, а не выкачивание всего
 * календаря: без фильтра неделя — это 38 валют и несколько страниц с
 * подгрузкой, из которых нам нужны девять (те же, что в CURRENCY_COUNTRY
 * в econcal.ts). С фильтром неделя укладывается в ОДИН ответ.
 *
 * Еврозона у investing разбита на страны: id 72 — это только сводные данные
 * по зоне, а немецкий и французский CPI лежат под своими id, хотя валюта у
 * них та же EUR. Без них календарь EUR оказался бы вдвое беднее фида
 * ForexFactory.
 */
const COUNTRY_IDS = [
  5, // США
  72, // Еврозона
  17, // Германия
  22, // Франция
  10, // Италия
  26, // Испания
  4, // Великобритания
  35, // Япония
  12, // Швейцария
  25, // Австралия
  6, // Канада
  43, // Новая Зеландия
  37, // Китай
];

/**
 * Часовой пояс выдачи. 55 — это UTC, проверено по релизу: американский CPI,
 * выходящий в 8:30 ET (12:30 UTC летом), приходит с data-event-datetime
 * «12:30». Просить сразу UTC важнее, чем кажется: время в разметке идёт БЕЗ
 * смещения, и угадывать его постфактум было бы нечем.
 */
const TIMEZONE_ID = 55;

// Эндпоинт отдаёт страницами; сколько строк в странице, решает он сам.
// bind_scroll_handler === true значит «есть ещё» — так это понимает и сама
// страница календаря при прокрутке.
const MAX_PAGES = 10;

/**
 * Запрос отправляем через curl, а НЕ через fetch. Это не прихоть.
 *
 * Календарь стоит за Cloudflare, и тот отбирает клиентов по отпечатку
 * TLS-рукопожатия (JA3), а не по заголовкам. Отпечаток Node узнаваем, и любой
 * запрос из него — хоть fetch, хоть undici с подогнанными шифрами и кривыми,
 * хоть обычный GET самой страницы — получает 403 со страницей-заглушкой
 * «Just a moment…». Тот же запрос тем же curl с той же машины и тем же IP
 * отвечает 200 (проверено рядом: Node — 403, curl — 200 и 497 КБ разметки).
 *
 * Подогнать отпечаток Node под браузерный из JS нельзя: дело не в списке
 * шифров (пробовал набор Chrome, порядок кривых, ALPN http/1.1 — всё те же
 * 403), а в порядке расширений ClientHello и GREASE, которых Node не умеет.
 *
 * curl — стандартная утилита, она уже ставится в образ (см. Dockerfile), а
 * запуск внешнего процесса для проекта не новость: так же работает бэкап БД.
 */
const CURL_TIMEOUT_SEC = 25;

/**
 * Человеческое объяснение вместо куска чужой разметки.
 *
 * Самый частый отказ — не поломка у нас, а защита investing: после серии
 * запросов подряд Cloudflare начинает отдавать страницу-проверку и держит её
 * заметно дольше минуты. Админ должен прочитать именно это, а не «HTTP-ошибка:
 * <!DOCTYPE html><html lang="en-US">…».
 */
/**
 * Ошибка «нас не пустили» — в отличие от сетевого сбоя её НЕЛЬЗЯ повторять
 * сразу: проверка Cloudflare висит на IP минутами и часами, и каждый повтор
 * только продлевает её. Вызывающий код по этому признаку уходит в паузу
 * (см. econcal.ts), а не долбится дальше.
 */
export class InvestingBlockedError extends Error {
  readonly blocked = true;
  constructor(message: string) {
    super(message);
    this.name = "InvestingBlockedError";
  }
}

export function isBlocked(err: unknown): boolean {
  return err instanceof Error && (err as { blocked?: boolean }).blocked === true;
}

function failureFor(body: string): Error {
  if (/Just a moment|cf-browser-verification|Checking your browser|challenge-platform/i.test(body)) {
    return new InvestingBlockedError(
      "investing закрыл доступ проверкой Cloudflare — она включается после частых обращений и держится от минут до нескольких часов. События подтянутся сами, как только источник снова начнёт отвечать; если ждать не хочется, переключите источник на ForexFactory в админке.",
    );
  }
  if (/Access denied|You have been blocked/i.test(body)) {
    return new InvestingBlockedError(
      "investing отклонил запрос — доступ закрыт для адреса этого сервера. Если не восстановится, переключите источник на ForexFactory в админке.",
    );
  }
  return new Error(`investing вернул ошибку: ${body.slice(0, 160).replace(/\s+/g, " ")}`);
}

/**
 * Один запрос curl. Обёртка с повтором — ниже: рукопожатие к investing изредка
 * обрывается (curl выходит с кодом 35), и терять из-за этого весь обход
 * календаря не за что.
 */
function curlPostOnce(url: string, form: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "--silent",
      "--show-error",
      // Тело отдаём даже на ошибочном коде: страница Cloudflare объясняет,
      // что произошло, и без неё в логах осталось бы только «exit 22».
      "--fail-with-body",
      "--location",
      "--max-time",
      String(CURL_TIMEOUT_SEC),
      "-X",
      "POST",
      // Тело — через stdin: в аргументах командной строки оно упёрлось бы в
      // предел длины и потребовало бы экранирования.
      "--data-binary",
      "@-",
      url,
    ];
    for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);

    let child;
    try {
      child = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      reject(new Error(`curl не запустился: ${(err as Error).message}`));
      return;
    }

    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => (out += c));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => (err += c));
    child.on("error", (e) => {
      const why =
        (e as NodeJS.ErrnoException).code === "ENOENT"
          ? "в системе нет curl — он обязателен для источника investing (см. Dockerfile)"
          : e.message;
      reject(new Error(why));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(out);
        return;
      }
      // 22 — HTTP-ошибка при --fail-with-body; тело лежит в out. Вываливать
      // его в админку куском разметки бессмысленно — админу нужно понять
      // причину, а не читать чужой HTML.
      reject(code === 22 ? failureFor(out) : new Error(`curl завершился с кодом ${code}: ${err.trim().slice(0, 160)}`));
    });

    child.stdin.end(form);
  });
}

/** Сколько раз пробуем один и тот же запрос, прежде чем сдаться. */
const CURL_ATTEMPTS = 3;

async function curlPost(url: string, form: string, headers: Record<string, string>): Promise<string> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= CURL_ATTEMPTS; attempt++) {
    try {
      return await curlPostOnce(url, form, headers);
    } catch (err) {
      last = err as Error;
      // Проверку Cloudflare повторять НЕЛЬЗЯ: она висит на адресе минутами и
      // часами, и три попытки подряд лишь утраивают частоту обращений — то
      // есть ровно то, чем она и вызывается. Повторяем только обрывы связи.
      if (isBlocked(err)) throw err;
      // Небольшая пауза между попытками: подряд идущие рукопожатия к тому же
      // хосту обрываются охотнее, чем разнесённые.
      if (attempt < CURL_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw last ?? new Error("curl не дал ответа");
}

export type InvestingEvent = {
  time: Date;
  currency: string;
  /** Название по-русски, как на сайте. */
  title: string;
  /** high | medium | low | holiday */
  impact: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
};

function impactFromStars(stars: number, title: string): string {
  // Праздники/выходные звёзд не имеют вовсе — у них отдельная пометка на
  // странице, и в нашей модели для них отдельное значение impact.
  if (stars <= 0) {
    return /праздник|выходн|нерабоч|банки закрыты/i.test(title) ? "holiday" : "low";
  }
  if (stars >= 3) return "high";
  if (stars === 2) return "medium";
  return "low";
}

/** «&nbsp;», пустая строка, одинокий прочерк — всё это «значения нет». */
function cellValue(text: string | undefined): string | null {
  const s = (text ?? "").replace(/ /g, " ").trim();
  if (!s || s === "-" || s === "—") return null;
  return s;
}

/**
 * Время события. В разметке оно записано как «2026/09/11 12:30:00» в
 * запрошенном поясе (у нас — UTC), без указания смещения, поэтому собираем
 * Date явно через Date.UTC: `new Date("2026/09/11 12:30:00")` разобрал бы
 * строку в ЛОКАЛЬНОМ поясе сервера, и весь календарь уехал бы на несколько
 * часов — незаметно, потому что выглядел бы правдоподобно.
 */
function parseDateTime(raw: string | undefined): Date | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec((raw ?? "").trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Разбор одной страницы выдачи. Экспортируется ради тестов на живой разметке. */
export function parseInvestingRows(html: string): InvestingEvent[] {
  const root = parse(html);
  const out: InvestingEvent[] = [];
  for (const row of root.querySelectorAll("tr.js-event-item")) {
    const time = parseDateTime(row.getAttribute("data-event-datetime"));
    if (!time) continue;

    // Валюта лежит в ячейке с флагом, текстом после самого флага.
    const currency = (row.querySelector("td.flagCur")?.text ?? "").trim().toUpperCase().slice(-3);
    if (!/^[A-Z]{3}$/.test(currency)) continue;

    const title = (row.querySelector("td.event")?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;

    // Звёзды — это <i class="grayFullBullishIcon"> внутри ячейки важности.
    // Считаем сами иконки, а не читаем data-img_key="bull3": у праздников и
    // пустых строк атрибут отсутствует, а иконки посчитать можно всегда.
    const stars = row.querySelectorAll("td.sentiment i.grayFullBullishIcon").length;

    out.push({
      time,
      currency,
      title,
      impact: impactFromStars(stars, title),
      actual: cellValue(row.querySelector("td.act")?.text),
      forecast: cellValue(row.querySelector("td.fore")?.text),
      previous: cellValue(row.querySelector("td.prev")?.text),
    });
  }
  return out;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * События investing за диапазон дат (границы включительно, по UTC).
 *
 * Страницы забираем подряд, пока сам эндпоинт говорит, что есть ещё
 * (bind_scroll_handler). Верхний предел на всякий случай: зациклиться на
 * чужой выдаче — худшее, что здесь может случиться.
 */
export async function fetchInvestingCalendar(from: Date, to: Date): Promise<InvestingEvent[]> {
  const events: InvestingEvent[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = new URLSearchParams({
      dateFrom: ymd(from),
      dateTo: ymd(to),
      timeZone: String(TIMEZONE_ID),
      currentTab: "custom",
      limit_from: String(offset),
    });
    for (const id of COUNTRY_IDS) body.append("country[]", String(id));

    const raw = await curlPost(ENDPOINT, body.toString(), HEADERS);
    let data: { data?: string; bind_scroll_handler?: boolean };
    try {
      data = JSON.parse(raw) as { data?: string; bind_scroll_handler?: boolean };
    } catch {
      // Не JSON — почти наверняка страница-заглушка Cloudflare. Говорим об
      // этом прямо: иначе в админке была бы невнятная ошибка разбора.
      throw new Error(
        `investing ответил не JSON (${raw.length} байт) — похоже на проверку Cloudflare`,
      );
    }
    const rows = parseInvestingRows(data.data ?? "");
    if (rows.length === 0) break;

    for (const ev of rows) {
      // Страницы у эндпоинта нарезаны по счётчику строк, а не по событиям, и
      // на стыке одна и та же строка приходит дважды. Ключ тот же, что у
      // уникального индекса в БД, — иначе задвоение всплыло бы уже на записи.
      const key = `${ev.time.getTime()}|${ev.currency}|${ev.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(ev);
    }

    if (!data.bind_scroll_handler) break;
    offset += 1;
  }
  return events;
}
