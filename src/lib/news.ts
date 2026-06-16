import { prisma } from "./db";

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
const UA =
  "Mozilla/5.0 (compatible; TradeStatsBot/1.0; +https://statstrade.vercel.app)";

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
    // Don't let one slow feed block the refresh (sources run in parallel).
    signal: AbortSignal.timeout(15000),
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

export async function refreshNews(lang: Lang): Promise<RefreshResult[]> {
  return Promise.all(
    NEWS_SOURCES[lang].map(async (src) => {
      try {
        return { source: src.id, added: await ingestSource(src, lang) };
      } catch (err) {
        return { source: src.id, added: 0, error: (err as Error).message };
      }
    }),
  );
}

// Best-effort per-language throttle so bursts on a warm instance don't hammer
// the upstream feeds (across instances it's still bounded by staleness).
const lastFetchAttempt: Record<Lang, number> = { en: 0, ru: 0 };

export async function getNews(opts: { lang?: Lang; force?: boolean; limit?: number } = {}) {
  const lang = asLang(opts.lang);
  const limit = opts.limit ?? 60;

  const newest = await prisma.newsItem.findFirst({
    where: { lang },
    orderBy: { publishedAt: "desc" },
    select: { publishedAt: true },
  });
  const stale = !newest || Date.now() - newest.publishedAt.getTime() > REFRESH_MS;
  const throttled = Date.now() - lastFetchAttempt[lang] < FETCH_THROTTLE_MS;

  let refreshed: RefreshResult[] = [];
  if (opts.force || (!throttled && stale)) {
    lastFetchAttempt[lang] = Date.now();
    refreshed = await refreshNews(lang);
  }

  const items = await prisma.newsItem.findMany({
    where: { lang },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
  return { items, lang, sources: NEWS_SOURCES[lang], refreshed };
}
