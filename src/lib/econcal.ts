import { prisma } from "./db";

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

// The feed marks some genuinely market-moving releases (Final CPI reprints,
// weekly Crude Oil Inventories) as "low" — bump those to "high" regardless
// of the feed's own label.
const HIGH_IMPACT_OVERRIDES: RegExp[] = [/\bcpi\b/i, /crude oil inventories/i];

function applyImpactOverride(title: string, impact: string): string {
  if (impact === "holiday") return impact;
  return HIGH_IMPACT_OVERRIDES.some((re) => re.test(title)) ? "high" : impact;
}

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
      impact: applyImpactOverride(title, normImpact(it.impact)),
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

export async function refreshCalendar(): Promise<RefreshResult[]> {
  const results = await Promise.all(
    FEEDS.map(async (url) => {
      const feed = url.split("/").pop() ?? url;
      try {
        const events = await fetchFeed(url);
        let upserted = 0;
        for (const e of events) {
          await prisma.economicEvent.upsert({
            where: { time_currency_title: { time: e.time, currency: e.currency, title: e.title } },
            create: e,
            update: { impact: e.impact, category: e.category, forecast: e.forecast, previous: e.previous, actual: e.actual },
          });
          upserted++;
        }
        return { feed, upserted };
      } catch (err) {
        return { feed, upserted: 0, error: (err as Error).message };
      }
    }),
  );
  await pruneOldEvents();
  return results;
}

let lastFetchAttempt = 0;

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
  if (filters.force || (!throttled && stale)) {
    lastFetchAttempt = Date.now();
    refreshed = await refreshCalendar();
  }

  const where: {
    time?: { gte?: Date; lte?: Date };
    currency?: { in: string[] };
    impact?: { in: string[] };
    category?: string;
  } = {};
  if (filters.from || filters.to) {
    where.time = {};
    if (filters.from) where.time.gte = filters.from;
    if (filters.to) where.time.lte = filters.to;
  }
  if (filters.currencies?.length) where.currency = { in: filters.currencies };
  if (filters.impacts?.length) where.impact = { in: filters.impacts };
  if (filters.category) where.category = filters.category;

  const events = await prisma.economicEvent.findMany({ where, orderBy: { time: "asc" }, take: 500 });

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
