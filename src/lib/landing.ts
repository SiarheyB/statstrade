/**
 * landing.ts — данные публичной главной страницы: счётчики, календарь на
 * ближайшие дни, сильнейший сетап дня и свежие новости.
 *
 * Всё считается ОДНИМ проходом и кладётся в общий кэш: главная — самая
 * посещаемая страница и единственная, куда ходят анонимы, поэтому каждый заход
 * не должен стоить пяти запросов в БД. TTL совпадает по порядку с частотой
 * обновления самих данных (рекомендации пересчитываются раз в сутки, календарь
 * и новости — раз в несколько минут).
 */

import { prisma } from "./db";
import { createRouteCache } from "./routeCache";
import { getCalendar } from "./econcal";
import { getNews, asLang, type Lang } from "./news";

/** Сколько дней календаря показываем на главной (сегодня + следующие). */
export const CALENDAR_DAYS = 3;
/** Сколько новостей показываем карточками. */
export const NEWS_LIMIT = 3;

const TTL_MS = 5 * 60 * 1000;
const cache = createRouteCache(TTL_MS, 8);

const DAY_MS = 86_400_000;

export type LandingEvent = {
  id: string;
  time: string;
  currency: string;
  country: string;
  title: string;
  impact: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
};

export type LandingNewsItem = {
  id: string;
  source: string;
  title: string;
  url: string;
  imageUrl: string | null;
  publishedAt: string;
};

/**
 * Сетап дня для гостя. Сознательно НЕ отдаём точку входа и разбор: показываем
 * факт сигнала (что найдено и насколько чистый уровень), а уровень входа,
 * сигналы «за/против» и график — уже в личном кабинете.
 */
export type LandingSignal = {
  symbol: string;
  bias: string;
  direction: string;
  levelType: string;
  strength: number;
  distanceAtr: number;
  runwayAtr: number | null;
  contamination: number | null;
  crossings: number | null;
  candlesTo: string;
  /** Сколько всего сетапов прошло отбор в этот день — «ещё N сетапов». */
  total: number;
};

export type LandingStats = {
  /** Сетапов в текущей выдаче рекомендаций. */
  setups: number;
  /** Инструментов, по которым есть дневные свечи (то есть в скане). */
  symbols: number;
  /** Событий календаря на сегодня. */
  events: number;
  /** Новостей за последние сутки. */
  news: number;
};

export type LandingData = {
  /**
   * Момент, на который собран срез. Возвращается наружу, чтобы страница не
   * дёргала Date.now() в рендере (нестабильный результат между рендерами —
   * см. react-hooks/purity) и чтобы подсветка «ближайшее событие» была
   * согласована с содержимым кэша.
   */
  generatedAt: number;
  stats: LandingStats;
  events: LandingEvent[];
  signal: LandingSignal | null;
  news: LandingNewsItem[];
};

/** Полночь UTC текущих суток — левая граница «сегодня» для календаря. */
function startOfToday(now: number): Date {
  return new Date(Math.floor(now / DAY_MS) * DAY_MS);
}

async function loadStats(from: Date, now: number): Promise<LandingStats> {
  const [setups, symbols, events, news] = await Promise.all([
    prisma.levelSetup.count(),
    prisma.obCandle
      .findMany({ where: { interval: "1d" }, distinct: ["symbol"], select: { symbol: true } })
      .then((rows) => rows.length),
    prisma.economicEvent.count({ where: { time: { gte: from, lt: new Date(from.getTime() + DAY_MS) } } }),
    prisma.newsItem.count({ where: { publishedAt: { gte: new Date(now - DAY_MS) } } }),
  ]);
  return { setups, symbols, events, news };
}

async function loadSignal(): Promise<LandingSignal | null> {
  const [best, total] = await Promise.all([
    prisma.levelSetup.findFirst({ orderBy: { score: "desc" } }),
    prisma.levelSetup.count(),
  ]);
  if (!best) return null;

  // quality — JSON-колонка, у старых записей часть метрик отсутствует (см.
  // quality.ts): читаем через проверку на конечное число, иначе карточка
  // покажет NaN.
  const q = (best.quality ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

  return {
    symbol: best.symbol,
    bias: best.bias,
    direction: best.direction,
    levelType: best.levelType,
    strength: best.strength,
    distanceAtr: best.distanceAtr,
    runwayAtr: num(q.runwayAtr),
    contamination: num(q.contamination),
    crossings: num(q.crossings),
    candlesTo: best.candlesTo.toISOString(),
    total,
  };
}

/**
 * Всё, что рисует главная. `lang` влияет только на ленту новостей — календарь и
 * рекомендации одинаковы для всех языков, поэтому ключ кэша по языку.
 */
export async function getLandingData(lang: Lang | string | null = null, now = Date.now()): Promise<LandingData> {
  const locale = asLang(typeof lang === "string" ? lang : null);
  return cache.fetch(`landing:${locale}`, async () => {
    const from = startOfToday(now);
    const to = new Date(from.getTime() + CALENDAR_DAYS * DAY_MS);

    const [stats, calendar, signal, news] = await Promise.all([
      loadStats(from, now),
      getCalendar({ from, to }),
      loadSignal(),
      getNews({ lang: locale, limit: NEWS_LIMIT }),
    ]);

    return {
      generatedAt: now,
      stats,
      events: calendar.events.map((e) => ({
        id: e.id,
        time: e.time.toISOString(),
        currency: e.currency,
        country: e.country,
        title: e.title,
        impact: e.impact,
        forecast: e.forecast,
        previous: e.previous,
        actual: e.actual,
      })),
      signal,
      news: news.items.slice(0, NEWS_LIMIT).map((n) => ({
        id: n.id,
        source: n.source,
        title: n.title,
        url: n.url,
        imageUrl: n.imageUrl,
        publishedAt: n.publishedAt.toISOString(),
      })),
    };
  });
}

/**
 * Группировка событий по дням для колонки календаря: заголовок дня + строки.
 * Дни определяются в таймзоне посетителя, поэтому границу считает вызывающий
 * код (см. zonedParts в lib/timezone.ts) — здесь только раскладка по ключу.
 */
export function groupEventsByDay(
  events: LandingEvent[],
  dayKey: (iso: string) => string,
): { key: string; events: LandingEvent[] }[] {
  const out: { key: string; events: LandingEvent[] }[] = [];
  for (const e of events) {
    const key = dayKey(e.time);
    const last = out[out.length - 1];
    if (last && last.key === key) last.events.push(e);
    else out.push({ key, events: [e] });
  }
  return out;
}
