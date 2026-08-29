import { prisma } from "./db";
import { Prisma } from "@prisma/client";
import { investingImpact, resolveImpact } from "./econcalImpact";

// Economic calendar from the free ForexFactory / faireconomy weekly JSON feeds
// (no API key). We pull last/this/next week, normalize, and upsert so the
// "actual" value is filled in once a release happens.

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

const CATEGORY_RULES: [RegExp, string][] = [
  [/payroll|employment|jobless|unemployment|\bnfp\b|\bjobs\b|claims/i, "Employment"],
  [/cpi|inflation|\bppi\b|price index|prices/i, "Inflation"],
  [/\brate\b|\bfomc\b|monetary|\bboe\b|\becb\b|\bfed funds\b/i, "Interest Rate"],
  [/\bgdp\b|growth/i, "GDP"],
  [/\bpmi\b|manufacturing|services|\bism\b|industrial/i, "PMI / Industry"],
  [/retail|consumer|spending|sales/i, "Consumer"],
  [/trade balance|current account|exports|imports/i, "Trade"],
  [/housing|building|home|mortgage|construction/i, "Housing"],
  [/confidence|sentiment|expectations/i, "Sentiment"],
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
async function alignStoredImpacts(): Promise<number> {
  const stored = await prisma.economicEvent.findMany({ select: { id: true, title: true, currency: true, impact: true } });
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
async function upsertEvents(events: NormalizedEvent[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < events.length; i += EVENT_UPSERT_BATCH) {
    const batch = events.slice(i, i + EVENT_UPSERT_BATCH);
    if (batch.length === 0) continue;
    const rows = batch.map(
      (e) => Prisma.sql`(${crypto.randomUUID()}, ${e.time}, ${e.currency}, ${e.country},
                         ${e.title}, ${e.impact}, ${e.category}, ${e.forecast},
                         ${e.previous}, ${e.actual}, NOW(), NOW())`,
    );
    written += await prisma.$executeRaw(
      Prisma.sql`INSERT INTO "EconomicEvent"
                   ("id","time","currency","country","title","impact","category",
                    "forecast","previous","actual","createdAt","updatedAt")
                 VALUES ${Prisma.join(rows)}
                 ON CONFLICT ("time","currency","title") DO UPDATE SET
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

export async function refreshCalendar(): Promise<RefreshResult[]> {
  const results = await Promise.all(
    FEEDS.map(async (url) => {
      const feed = url.split("/").pop() ?? url;
      try {
        const events = await fetchFeed(url);
        const upserted = await upsertEvents(events);
        return { feed, upserted };
      } catch (err) {
        return { feed, upserted: 0, error: (err as Error).message };
      }
    }),
  );
  await pruneOldEvents();
  await alignStoredImpacts();
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
  const newest = await prisma.economicEvent.findFirst({
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
    time?: { gte?: Date; lte?: Date };
    currency?: { in: string[] };
    category?: string;
  } = {};
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
  const rows = await prisma.economicEvent.findMany({ where, orderBy: { time: "asc" }, take: 500 });
  const wanted = filters.impacts?.length ? new Set(filters.impacts) : null;
  const events = rows
    .map((e) => ({ ...e, impact: resolveImpact(e.title, e.currency, e.impact) }))
    .filter((e) => !wanted || wanted.has(e.impact));

  // Facets for the filter UI (distinct currencies / categories present).
  // groupBy, а не выгрузка всей таблицы в память: строк тут немного, но
  // список фильтров не должен зависеть от размера календаря.
  const [curRows, catRows] = await Promise.all([
    prisma.economicEvent.groupBy({ by: ["currency"] }),
    prisma.economicEvent.groupBy({ by: ["category"] }),
  ]);
  const currencies = curRows.map((r) => r.currency).sort();
  const categories = (catRows.map((r) => r.category).filter(Boolean) as string[]).sort();

  return { events, currencies, categories, refreshed };
}
