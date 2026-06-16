import { prisma } from "./db";

export type NewsSource = { id: string; name: string; url: string };

// Three of the most market-impactful crypto outlets that expose a free RSS feed.
export const NEWS_SOURCES: NewsSource[] = [
  { id: "coindesk", name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml" },
  { id: "cointelegraph", name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { id: "decrypt", name: "Decrypt", url: "https://decrypt.co/feed" },
];

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

// --- Minimal RSS 2.0 parsing (the three feeds are standard <item> RSS). ---

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
    // Drop tracking query params so the URL is a stable dedup key.
    url = url.split("?")[0];

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

async function ingestSource(src: NewsSource): Promise<number> {
  const res = await fetch(src.url, {
    headers: {
      "user-agent": UA,
      accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
    },
    cache: "no-store",
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

export async function refreshNews(): Promise<RefreshResult[]> {
  return Promise.all(
    NEWS_SOURCES.map(async (src) => {
      try {
        return { source: src.id, added: await ingestSource(src) };
      } catch (err) {
        return { source: src.id, added: 0, error: (err as Error).message };
      }
    }),
  );
}

// Best-effort throttle so a burst of requests on one warm instance doesn't
// hammer the upstream feeds (across instances it's still bounded by staleness).
let lastFetchAttempt = 0;

export async function getNews(opts: { force?: boolean; limit?: number } = {}) {
  const limit = opts.limit ?? 60;
  const newest = await prisma.newsItem.findFirst({
    orderBy: { publishedAt: "desc" },
    select: { publishedAt: true },
  });
  const stale = !newest || Date.now() - newest.publishedAt.getTime() > REFRESH_MS;
  const throttled = Date.now() - lastFetchAttempt < FETCH_THROTTLE_MS;

  let refreshed: RefreshResult[] = [];
  if (opts.force || (!throttled && stale)) {
    lastFetchAttempt = Date.now();
    refreshed = await refreshNews();
  }

  const items = await prisma.newsItem.findMany({
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
  return { items, sources: NEWS_SOURCES, refreshed };
}
