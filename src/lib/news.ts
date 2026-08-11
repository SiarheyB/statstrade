import { prisma } from "./db";
import { getFeatureConfig } from "./featureConfig";

export type Lang = "en" | "ru";
export type NewsSource = { id: string; name: string; url: string };

// The most market-impactful crypto outlets per language, each with a free RSS
// feed. RU uses native Russian outlets so headlines and links are in Russian.
export const NEWS_SOURCES: Record<Lang, NewsSource[]> = {
  en: [
    { id: "coindesk", name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml" },
    { id: "cointelegraph", name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
    { id: "decrypt", name: "Decrypt", url: "https://decrypt.co/feed" },
  ],
  ru: [
    { id: "forklog", name: "ForkLog", url: "https://forklog.com/feed/" },
    { id: "beincrypto-ru", name: "BeInCrypto", url: "https://ru.beincrypto.com/feed/" },
    { id: "incrypted", name: "Incrypted", url: "https://incrypted.com/feed/" },
  ],
};

export function asLang(value: string | null | undefined): Lang {
  return value === "ru" ? "ru" : "en";
}

const REFRESH_MS = 15 * 60 * 1000;
const FETCH_THROTTLE_MS = 60 * 1000;
const FEED_TIMEOUT_MS = 5000;
const UA =
  "Mozilla/5.0 (compatible; TradeStatsBot/1.0; +https://tradingstat.ru)";

type ParsedItem = {
  title: string;
  url: string;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: Date;
};

// --- Minimal RSS 2.0 parsing (all feeds are standard <item> RSS). ---

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)));
}

function clean(raw: string | null): string {
  if (!raw) return "";
  return decodeEntities(raw).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function tagContent(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : null;
}

function attrUrl(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}\\b[^>]*\\burl=["']([^"']+)["']`, "i"));
  return m ? m[1] : null;
}

function parseFeed(xml: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const title = clean(tagContent(block, "title"));
    let url = clean(tagContent(block, "link"));
    if (!url) {
      const guid = clean(tagContent(block, "guid"));
      if (/^https?:\/\//.test(guid)) url = guid;
    }
    if (!title || !/^https?:\/\//.test(url)) continue;
    url = url.split("?")[0]; // drop tracking params -> stable dedup key

    const summary = clean(tagContent(block, "description")).slice(0, 400) || null;
    const pubRaw = clean(tagContent(block, "pubDate")) || clean(tagContent(block, "dc:date"));
    const pub = pubRaw ? new Date(pubRaw) : new Date();
    const imageUrl =
      attrUrl(block, "media:content") ??
      attrUrl(block, "media:thumbnail") ??
      attrUrl(block, "enclosure") ??
      null;

    items.push({
      title,
      url,
      summary,
      imageUrl,
      publishedAt: Number.isNaN(pub.getTime()) ? new Date() : pub,
    });
  }
  return items;
}

async function ingestSource(src: NewsSource, lang: Lang): Promise<number> {
  const res = await fetch(src.url, {
    headers: {
      "user-agent": UA,
      accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
    },
    cache: "no-store",
    // Фид, не ответивший за 5с, ждём до следующего цикла: обход всё равно
    // фоновый, а на первом (синхронном) заходе это потолок ожидания.
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();

  const seen = new Set<string>();
  const rows = [];
  for (const it of parseFeed(xml)) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    rows.push({
      source: src.id,
      lang,
      title: it.title,
      url: it.url,
      summary: it.summary,
      imageUrl: it.imageUrl,
      publishedAt: it.publishedAt,
    });
  }
  if (rows.length === 0) return 0;
  const r = await prisma.newsItem.createMany({ data: rows, skipDuplicates: true });
  return r.count;
}

export type RefreshResult = { source: string; added: number; error?: string };

// Сколько дней держать новости в БД. Настраивается админом в /admin/features
// («Новости» → retentionDays); 0/отрицательное = не удалять ничего.
export async function getRetentionDays(): Promise<number> {
  const cfg = await getFeatureConfig("newsFeed");
  const days = Number(cfg.retentionDays);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

// Единственная чистка новостей в проекте: отдельного retention-джоба (как у
// orderflow в коллекторе) у NewsItem нет, поэтому удаляем прямо после обхода
// фидов — иначе таблица растёт бесконечно.
export async function pruneOldNews(retentionDays?: number): Promise<number> {
  const days = retentionDays ?? (await getRetentionDays());
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { count } = await prisma.newsItem.deleteMany({ where: { publishedAt: { lt: cutoff } } });
  return count;
}

// Когда мы последний раз ПЫТАЛИСЬ обойти фиды (по языку). Раньше свежесть
// определялась по publishedAt самой новой статьи — но если издания молчат
// (ночь, выходные), лента вечно считается протухшей и каждый заход тащит нас
// в сеть. Метку держим в FeatureConfig под служебным ключом: его нет в
// FEATURE_DEFAULTS, поэтому в /admin/features строка не видна и не правится.
const REFRESH_STATE_KEY = "newsFeedState";

async function readLastRefresh(): Promise<Record<Lang, number>> {
  const row = await prisma.featureConfig.findUnique({ where: { key: REFRESH_STATE_KEY } });
  if (!row?.config) return { en: 0, ru: 0 };
  try {
    const parsed = JSON.parse(row.config) as Partial<Record<Lang, number>>;
    return { en: Number(parsed.en) || 0, ru: Number(parsed.ru) || 0 };
  } catch {
    return { en: 0, ru: 0 };
  }
}

async function writeLastRefresh(lang: Lang, ts: number): Promise<void> {
  // Гонка двух языков может потерять чужую метку — не страшно, худший случай
  // это один лишний обход фидов.
  const state = { ...(await readLastRefresh()), [lang]: ts };
  await prisma.featureConfig.upsert({
    where: { key: REFRESH_STATE_KEY },
    create: { key: REFRESH_STATE_KEY, enabled: true, config: JSON.stringify(state) },
    update: { config: JSON.stringify(state) },
  });
}

export async function refreshNews(lang: Lang, retentionDays?: number): Promise<RefreshResult[]> {
  const results = await Promise.all(
    NEWS_SOURCES[lang].map(async (src) => {
      try {
        return { source: src.id, added: await ingestSource(src, lang) };
      } catch (err) {
        return { source: src.id, added: 0, error: (err as Error).message };
      }
    }),
  );
  await pruneOldNews(retentionDays);
  await writeLastRefresh(lang, Date.now());
  return results;
}

// Обход фидов, уже идущий в этом процессе: второй параллельный запрос не
// должен запускать его повторно.
const inFlight: Record<Lang, Promise<unknown> | null> = { en: null, ru: null };

function refreshInBackground(lang: Lang, retentionDays: number): void {
  if (inFlight[lang]) return;
  inFlight[lang] = refreshNews(lang, retentionDays)
    .catch(() => {
      // Фоновое обновление не должно ронять запрос пользователя: следующий
      // заход попробует снова (метку времени пишет сам refreshNews).
    })
    .finally(() => {
      inFlight[lang] = null;
    });
}

export async function getNews(opts: { lang?: Lang; force?: boolean; limit?: number } = {}) {
  const lang = asLang(opts.lang);
  const limit = opts.limit ?? 60;

  const readItems = () =>
    prisma.newsItem.findMany({
      where: { lang },
      orderBy: { publishedAt: "desc" },
      take: limit,
    });

  const [cfg, lastRefresh, initial] = await Promise.all([
    getFeatureConfig("newsFeed"),
    readLastRefresh(),
    readItems(),
  ]);
  const retentionDays =
    Number.isFinite(Number(cfg.retentionDays)) && Number(cfg.retentionDays) > 0
      ? Number(cfg.retentionDays)
      : 0;
  const stale = Date.now() - lastRefresh[lang] > REFRESH_MS;

  // Выключенная в /admin/features фича замораживает ленту: ни походов в RSS,
  // ни удаления старых записей (см. описание фичи newsFeed).
  let items = initial;
  let refreshed: RefreshResult[] = [];
  let refreshing = false;

  if (cfg.enabled) {
    // Ждём обход фидов только там, где иначе показывать нечего: ручное
    // «обновить» и первый заход на пустую ленту. В остальных случаях отдаём
    // то, что уже в БД, а фиды обходим в фоне — страница не ждёт сеть.
    if (opts.force || items.length === 0) {
      const throttled = Date.now() - lastRefresh[lang] < FETCH_THROTTLE_MS;
      if (opts.force || !throttled) {
        refreshed = await refreshNews(lang, retentionDays);
        items = await readItems();
      }
    } else if (stale) {
      refreshInBackground(lang, retentionDays);
      refreshing = true;
    }
  }

  return { items, lang, sources: NEWS_SOURCES[lang], refreshed, refreshing };
}
