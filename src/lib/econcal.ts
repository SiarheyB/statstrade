import { prisma } from "./db";
import { Prisma } from "@prisma/client";
import { investingImpact, resolveImpact } from "./econcalImpact";
import { fetchInvestingCalendar, isBlocked } from "./econcalInvesting";
import { getFeatureConfig } from "./featureConfig";

// Economic calendar from the free ForexFactory / faireconomy weekly JSON feeds
// (no API key). We pull last/this/next week, normalize, and upsert so the
// "actual" value is filled in once a release happens.
//
// Второй источник — ru.investing.com (см. econcalInvesting.ts). Какой из двух
// показывать (и показывать ли календарь вообще) решает переключатель в
// /admin/content: фича `econcal`, поле `source`. События обоих источников
// лежат в ОДНОЙ таблице и различаются колонкой source, поэтому переключение
// туда-обратно мгновенное и ничего не стирает.

/** Источник событий. Значение колонки EconomicEvent.source. */
export type CalendarSource = "forexfactory" | "investing";

export const CALENDAR_SOURCES: CalendarSource[] = ["forexfactory", "investing"];

function asSource(v: unknown): CalendarSource {
  return v === "investing" ? "investing" : "forexfactory";
}

/**
 * Что настроено в админке. Отдельно `enabled` — общий выключатель раздела:
 * выключенный календарь не показывается никому и не обходится фоном.
 */
export async function calendarSettings(): Promise<{ enabled: boolean; source: CalendarSource }> {
  const cfg = await getFeatureConfig("econcal");
  return { enabled: cfg.enabled, source: asSource(cfg.source) };
}

// The free ForexFactory/faireconomy feed reliably serves only the current week.
// The DB accumulates events across refreshes, so past weeks fill in over time.
const FEEDS = ["https://nfs.faireconomy.media/ff_calendar_thisweek.json"];

const REFRESH_MS = 30 * 60 * 1000; // refresh at most every 30 min
const FETCH_THROTTLE_MS = 60 * 1000;
const UA = "Mozilla/5.0 (compatible; TradeStatsBot/1.0; +https://tradingstat.ru)";

// The feed's "country" field actually holds a currency code.
const CURRENCY_COUNTRY: Record<string, { country: string; iso: string }> = {
  USD: { country: "United States", iso: "US" },
  EUR: { country: "Euro Area", iso: "EU" },
  GBP: { country: "United Kingdom", iso: "GB" },
  JPY: { country: "Japan", iso: "JP" },
  CHF: { country: "Switzerland", iso: "CH" },
  AUD: { country: "Australia", iso: "AU" },
  CAD: { country: "Canada", iso: "CA" },
  NZD: { country: "New Zealand", iso: "NZ" },
  CNY: { country: "China", iso: "CN" },
};

export function countryFor(currency: string): string {
  return CURRENCY_COUNTRY[currency]?.country ?? currency;
}

// Regional-indicator flag emoji from an ISO-3166 alpha-2 code (EU has its own).
export function flagFor(currency: string): string {
  const iso = CURRENCY_COUNTRY[currency]?.iso;
  if (!iso) return "🏳️";
  if (iso === "EU") return "🇪🇺";
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Категории выводятся из НАЗВАНИЯ события, а название зависит от источника:
// ForexFactory пишет по-английски, investing — по-русски. Поэтому у каждого
// правила две половины; порядок правил общий, и событие получает ту же
// категорию независимо от того, откуда пришло, — иначе фильтр по категории
// на странице менял бы смысл при переключении источника.
const CATEGORY_RULES: [RegExp, string][] = [
  [/payroll|employment|jobless|unemployment|\bnfp\b|\bjobs\b|claims|занятост|безработ|вакансий|заявок на пособие|рабочих мест|заработн/i, "Employment"],
  [/cpi|inflation|\bppi\b|price index|prices|ипц|инфляц|индекс цен|индекс потребительских цен|цен производителей/i, "Inflation"],
  [/\brate\b|\bfomc\b|monetary|\bboe\b|\becb\b|\bfed funds\b|ставк|фомс|денежно-кредитн|заседани|протокол/i, "Interest Rate"],
  [/\bgdp\b|growth|ввп|валовой внутренний/i, "GDP"],
  [/\bpmi\b|manufacturing|services|\bism\b|industrial|pmi|индекс деловой активности|производств|промышленн|сфер услуг/i, "PMI / Industry"],
  [/retail|consumer|spending|sales|розничн|потребительск|продаж|расход/i, "Consumer"],
  [/trade balance|current account|exports|imports|торговый баланс|текущего счета|текущих операций|экспорт|импорт/i, "Trade"],
  [/housing|building|home|mortgage|construction|жиль|строительств|ипотеч|новостро|недвижимост/i, "Housing"],
  [/confidence|sentiment|expectations|настроен|доверия|ожидани|уверенност/i, "Sentiment"],
];

function categoryFor(title: string): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(title)) return cat;
  return "Other";
}

function normImpact(raw: unknown): string {
  const s = String(raw ?? "").toLowerCase();
  if (s.startsWith("high")) return "high";
  if (s.startsWith("med")) return "medium";
  if (s.startsWith("low")) return "low";
  if (s.includes("holiday")) return "holiday";
  return "low";
}

// Важность события берём не из фида, а по шкале investing.com — фид метит
// её заметно иначе (см. src/lib/econcalImpact.ts).

type FeedItem = {
  title?: string;
  country?: string; // currency code
  date?: string; // ISO8601 with offset
  impact?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
};

type NormalizedEvent = {
  time: Date;
  currency: string;
  country: string;
  title: string;
  impact: string;
  category: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
};

async function fetchFeed(url: string): Promise<NormalizedEvent[]> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as FeedItem[];
  const out: NormalizedEvent[] = [];
  for (const it of Array.isArray(data) ? data : []) {
    const title = (it.title ?? "").trim();
    const currency = (it.country ?? "").trim().toUpperCase();
    const time = it.date ? new Date(it.date) : null;
    if (!title || !currency || !time || Number.isNaN(time.getTime())) continue;
    const clean = (v: unknown) => {
      const s = String(v ?? "").trim();
      return s && s !== "" ? s : null;
    };
    out.push({
      time,
      currency,
      country: countryFor(currency),
      title,
      impact: resolveImpact(title, currency, normImpact(it.impact)),
      category: categoryFor(title),
      forecast: clean(it.forecast),
      previous: clean(it.previous),
      actual: clean(it.actual),
    });
  }
  return out;
}

export type RefreshResult = { feed: string; upserted: number; error?: string };

// Понедельник 00:00 UTC текущей недели.
function startOfWeekUtc(now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const mondayOffset = (d.getUTCDay() + 6) % 7; // вс = 0 → 6 дней назад
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d;
}

// Единственная чистка календаря: фид отдаёт только текущую неделю, а таблица
// копила события всех прошлых обходов. Прошлая неделя уходит сама собой, как
// только начинается новая, — настраивать тут нечего.
//
// Режем по времени события (не по createdAt), с запасом в сутки от начала
// недели: страница считает границы недели в ЧАСОВОМ ПОЯСЕ пользователя
// (см. weekStart в dashboard/econcal), который может отставать от UTC на
// половину суток — без запаса у части пользователей понедельник опустел бы.
const WEEK_EDGE_SLACK_MS = 24 * 60 * 60 * 1000;

export async function pruneOldEvents(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(startOfWeekUtc(now).getTime() - WEEK_EDGE_SLACK_MS);
  const { count } = await prisma.economicEvent.deleteMany({ where: { time: { lt: cutoff } } });
  return count;
}

// Фид переставляет время публикации (ForexFactory поправил минуту — в таблице
// остаётся и старая строка, и новая), и осиротевшая запись живёт до конца
// недели с той важностью, с какой её когда-то сохранили. Проходим по всему,
// что лежит в календаре, и выравниваем важность по шкале investing —
// события, которых в нашей таблице нет, не трогаем.
// Только для ForexFactory: у investing звёзды приходят из самого investing, и
// накладывать на них ручную таблицу значило бы исправлять источник по его же
// собственным данным.
async function alignStoredImpacts(): Promise<number> {
  const stored = await prisma.economicEvent.findMany({
    where: { source: "forexfactory" },
    select: { id: true, title: true, currency: true, impact: true },
  });
  const byImpact = new Map<string, string[]>();
  for (const e of stored) {
    if (e.impact === "holiday") continue;
    const want = investingImpact(e.title, e.currency);
    if (!want || want === e.impact) continue;
    const ids = byImpact.get(want) ?? [];
    ids.push(e.id);
    byImpact.set(want, ids);
  }
  let updated = 0;
  for (const [impact, ids] of byImpact) {
    const { count } = await prisma.economicEvent.updateMany({ where: { id: { in: ids } }, data: { impact } });
    updated += count;
  }
  return updated;
}


/** Сколько событий кладём одним запросом (у модели 10 колонок, предел
 *  параметров Postgres — 65535, так что запас многократный). */
const EVENT_UPSERT_BATCH = 500;

/**
 * Запись событий пачками вместо upsert в цикле.
 *
 * Недельный фид — это 150-300 событий, фидов несколько, и каждое событие
 * стоило отдельного round-trip к БД: сотни последовательных запросов на один
 * обход. Здесь то же самое одним INSERT … ON CONFLICT на пачку.
 *
 * Обновляются ровно те же поля, что и раньше: time/currency/title образуют
 * ключ и не трогаются, country тоже (он выводится из currency и не меняется).
 */
async function upsertEvents(events: NormalizedEvent[], source: CalendarSource): Promise<number> {
  // Внутри ОДНОГО INSERT … ON CONFLICT два одинаковых ключа — это ошибка
  // Postgres 21000 «ON CONFLICT DO UPDATE command cannot affect row a second
  // time» (проверено на живой базе). Прежний upsert в цикле такое переживал,
  // а здесь падала бы вся пачка — то есть обход календаря вставал бы целиком
  // из-за одной задвоенной строки в чужом фиде. ForexFactory задваивает:
  // он правит минуту публикации, и одно и то же событие приходит дважды.
  //
  // Схлопываем по ключу (time+currency+title), оставляя ПОСЛЕДНЕЕ — так же
  // вёл себя upsert в цикле: последняя запись перетирала предыдущую.
  const byKey = new Map<string, NormalizedEvent>();
  for (const e of events) {
    byKey.set(`${e.time.getTime()}|${e.currency}|${e.title}`, e);
  }
  const unique = [...byKey.values()];

  let written = 0;
  for (let i = 0; i < unique.length; i += EVENT_UPSERT_BATCH) {
    const batch = unique.slice(i, i + EVENT_UPSERT_BATCH);
    if (batch.length === 0) continue;
    const rows = batch.map(
      (e) => Prisma.sql`(${crypto.randomUUID()}, ${e.time}, ${e.currency}, ${e.country},
                         ${e.title}, ${e.impact}, ${e.category}, ${e.forecast},
                         ${e.previous}, ${e.actual}, ${source}, NOW(), NOW())`,
    );
    written += await prisma.$executeRaw(
      Prisma.sql`INSERT INTO "EconomicEvent"
                   ("id","time","currency","country","title","impact","category",
                    "forecast","previous","actual","source","createdAt","updatedAt")
                 VALUES ${Prisma.join(rows)}
                 ON CONFLICT ("source","time","currency","title") DO UPDATE SET
                   "impact" = EXCLUDED."impact",
                   "category" = EXCLUDED."category",
                   "forecast" = EXCLUDED."forecast",
                   "previous" = EXCLUDED."previous",
                   "actual" = EXCLUDED."actual",
                   "updatedAt" = NOW()`,
    );
  }
  return written;
}

/**
 * Окно, которое тянем у investing: с понедельника ТЕКУЩЕЙ недели по
 * воскресенье СЛЕДУЮЩЕЙ.
 *
 * Две недели, а не одна, ровно затем, чтобы воскресный вечерний обход уже
 * привозил всю будущую неделю: человек, открывший календарь в воскресенье,
 * должен видеть понедельник, а не пустоту. Текущая неделя в окне тоже нужна —
 * в неё в течение дня доливаются фактические значения (actual).
 */
function investingWindow(now: Date = new Date()): { from: Date; to: Date } {
  const from = startOfWeekUtc(now);
  const to = new Date(from.getTime() + 13 * 24 * 3600_000);
  return { from, to };
}

/**
 * Пауза после того, как investing закрылся проверкой Cloudflare.
 *
 * Проверка включается от ЧАСТОТЫ обращений и держится от минут до нескольких
 * часов. Обычная логика обновления (устарело — сходи ещё раз) в этом состоянии
 * работает против нас: каждый заход на страницу пробовал бы снова и продлевал
 * блокировку. Поэтому после отказа выдерживаем паузу, удваивая её при каждом
 * следующем отказе, — и не трогаем источник, пока она не выйдет.
 */
const BLOCK_BACKOFF_MIN_MS = 15 * 60_000;
const BLOCK_BACKOFF_MAX_MS = 4 * 3600_000;
let blockedUntil = 0;
let blockStreak = 0;
// Почему выбранный источник молчит. Показывается вместо пустого календаря:
// «событий нет» и «источник недоступен» — разные вещи, и человек должен
// понимать, какая из них перед ним.
let lastSourceError: string | null = null;

/** Только для тестов: снять паузу. */
export function resetInvestingBackoff(): void {
  blockedUntil = 0;
  blockStreak = 0;
  lastSourceError = null;
}

function noteInvestingBlocked(message: string): void {
  lastSourceError = message;
  blockStreak += 1;
  const wait = Math.min(BLOCK_BACKOFF_MIN_MS * 2 ** (blockStreak - 1), BLOCK_BACKOFF_MAX_MS);
  blockedUntil = Date.now() + wait;
}

function noteInvestingOk(): void {
  blockedUntil = 0;
  blockStreak = 0;
  lastSourceError = null;
}

async function refreshInvesting(): Promise<RefreshResult[]> {
  const { from, to } = investingWindow();
  const feed = "ru.investing.com";
  if (Date.now() < blockedUntil) {
    const minutes = Math.ceil((blockedUntil - Date.now()) / 60_000);
    const message = `investing закрыт проверкой Cloudflare. Следующая попытка примерно через ${minutes} мин — чаще нельзя, частые обращения продлевают проверку.`;
    lastSourceError = message;
    return [{ feed, upserted: 0, error: message }];
  }
  try {
    const raw = await fetchInvestingCalendar(from, to);
    const events: NormalizedEvent[] = raw.map((e) => ({
      time: e.time,
      currency: e.currency,
      country: countryFor(e.currency),
      title: e.title,
      // Важность как есть, со звёзд investing: ручная таблица соответствия
      // (econcalImpact.ts) существует только для того, чтобы ПРИБЛИЗИТЬ
      // ForexFactory к этой шкале, и здесь она была бы кругом.
      impact: e.impact,
      category: categoryFor(e.title),
      forecast: e.forecast,
      previous: e.previous,
      actual: e.actual,
    }));
    const upserted = await upsertEvents(events, "investing");
    noteInvestingOk();
    return [{ feed, upserted }];
  } catch (err) {
    const message = (err as Error).message;
    if (isBlocked(err)) noteInvestingBlocked(message);
    else lastSourceError = message;
    return [{ feed, upserted: 0, error: message }];
  }
}

async function refreshForexFactory(): Promise<RefreshResult[]> {
  const results = await Promise.all(
    FEEDS.map(async (url) => {
      const feed = url.split("/").pop() ?? url;
      try {
        const events = await fetchFeed(url);
        const upserted = await upsertEvents(events, "forexfactory");
        return { feed, upserted };
      } catch (err) {
        return { feed, upserted: 0, error: (err as Error).message };
      }
    }),
  );
  await alignStoredImpacts();
  return results;
}

/**
 * Обход выбранного источника. Без аргумента берётся тот, что стоит в админке —
 * так вызывают и кнопка «обновить» в /admin/content, и фоновое обновление.
 * Явный аргумент нужен только тому, кто хочет обойти конкретный источник
 * независимо от настройки.
 */
export async function refreshCalendar(source?: CalendarSource): Promise<RefreshResult[]> {
  const active = source ?? (await calendarSettings()).source;
  const results =
    active === "investing" ? await refreshInvesting() : await refreshForexFactory();
  // Чистка общая для обоих источников: она режет по времени события, а не по
  // тому, откуда оно пришло.
  await pruneOldEvents();
  return results;
}

let lastFetchAttempt = 0;

// Обход фида, уже идущий в этом процессе: параллельные запросы не должны
// запускать его повторно (как в lib/news.ts).
let inFlight: Promise<unknown> | null = null;

function refreshInBackground(): void {
  if (inFlight) return;
  inFlight = refreshCalendar()
    .catch(() => {
      // Фоновое обновление не должно ронять запрос пользователя: следующий
      // заход попробует снова.
    })
    .finally(() => {
      inFlight = null;
    });
}

export type CalendarFilters = {
  from?: Date;
  to?: Date;
  currencies?: string[];
  impacts?: string[];
  category?: string;
  force?: boolean;
};

export async function getCalendar(filters: CalendarFilters = {}) {
  const { enabled, source } = await calendarSettings();
  // Календарь выключен в админке — отдаём пустую выдачу и НЕ ходим в сеть.
  // Тихо, а не ошибкой: этот же вызов обслуживает лендинг и публичную
  // страницу /calendar, где отсутствие блока лучше красного экрана.
  if (!enabled) {
    return { events: [], currencies: [], categories: [], refreshed: [] as RefreshResult[] };
  }

  // Свежесть считаем ПО ИСТОЧНИКУ: сразу после переключения в админке в
  // таблице лежат свежие строки другого источника, и общий запрос решил бы,
  // что обходить нечего, — новый источник остался бы пустым до получаса.
  const newest = await prisma.economicEvent.findFirst({
    where: { source },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  const stale = !newest || Date.now() - newest.updatedAt.getTime() > REFRESH_MS;
  const throttled = Date.now() - lastFetchAttempt < FETCH_THROTTLE_MS;
  let refreshed: RefreshResult[] = [];

  // Ждём обход фида только там, где иначе показывать нечего: ручное
  // «обновить» и пустая таблица. Иначе страница вставала на десятки секунд —
  // фид отвечает не мгновенно (таймаут 15 с), а следом идёт сотня upsert'ов,
  // и всё это происходило прямо в рендере главной. Устаревшие данные обновляем
  // в фоне: показать календарь получасовой давности лучше, чем держать
  // человека перед пустым экраном.
  if (filters.force || (!throttled && !newest)) {
    lastFetchAttempt = Date.now();
    refreshed = await refreshCalendar();
  } else if (!throttled && stale) {
    lastFetchAttempt = Date.now();
    refreshInBackground();
  }

  const where: {
    source: CalendarSource;
    time?: { gte?: Date; lte?: Date };
    currency?: { in: string[] };
    category?: string;
  } = { source };
  if (filters.from || filters.to) {
    where.time = {};
    if (filters.from) where.time.gte = filters.from;
    if (filters.to) where.time.lte = filters.to;
  }
  if (filters.currencies?.length) where.currency = { in: filters.currencies };
  if (filters.category) where.category = filters.category;

  // Важность накладываем на чтении, а не берём из колонки: правка таблицы в
  // econcalImpact.ts видна сразу, не дожидаясь ближайшего обхода фида. В базе
  // значение тоже обновится — при следующем refreshCalendar().
  //
  // Поэтому и фильтр по важности здесь, а не в SQL: в колонке может лежать
  // ещё старое значение, и запрос отобрал бы не те строки. Событий в
  // календаре — сотни, лишней работы это не создаёт.
  // Показываем РОВНО выбранный источник и ничего больше.
  //
  // Подмешивать второй источник, когда выбранный молчит, нельзя: выбор
  // источника — это выбор шкалы важности и языка названий, и молчаливая
  // подмена означала бы, что человек смотрит не на тот календарь, который
  // выбрал, не зная об этом. Если выбранный источник недоступен, календарь
  // остаётся пустым, но объясняет причину (sourceError ниже).
  const rows = await prisma.economicEvent.findMany({ where, orderBy: { time: "asc" }, take: 500 });
  const shown: CalendarSource = source;
  const wanted = filters.impacts?.length ? new Set(filters.impacts) : null;
  const events = rows
    // Наложение ручной таблицы — только для ForexFactory. У investing важность
    // и так его собственная, и «поправлять» её нашей копией той же шкалы
    // значило бы вносить расхождение там, где его нет.
    .map((e) =>
      shown === "forexfactory"
        ? { ...e, impact: resolveImpact(e.title, e.currency, e.impact) }
        : e,
    )
    .filter((e) => !wanted || wanted.has(e.impact));

  // Facets for the filter UI (distinct currencies / categories present).
  // groupBy, а не выгрузка всей таблицы в память: строк тут немного, но
  // список фильтров не должен зависеть от размера календаря.
  // Списки фильтров — по тому же источнику, что и показанные события: иначе
  // после отката в выпадающих списках оказались бы валюты и категории того
  // источника, которого на экране нет.
  const [curRows, catRows] = await Promise.all([
    prisma.economicEvent.groupBy({ by: ["currency"], where: { source: shown } }),
    prisma.economicEvent.groupBy({ by: ["category"], where: { source: shown } }),
  ]);
  const currencies = curRows.map((r) => r.currency).sort();
  const categories = (catRows.map((r) => r.category).filter(Boolean) as string[]).sort();

  // fellBackTo !== null значит «выбран один источник, показан другой» —
  // админке есть что об этом сказать, а тесты проверяют сам факт отката.
  // sourceError — почему выбранный источник молчит. Заполнен только когда
  // событий и правда нет: при непустом календаре старая ошибка обхода уже
  // ничего не значит.
  return {
    events,
    currencies,
    categories,
    refreshed,
    source: shown,
    sourceError: events.length === 0 ? lastSourceError : null,
  };
}
