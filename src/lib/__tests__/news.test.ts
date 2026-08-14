import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks to avoid initialization errors
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn().mockResolvedValue(null),
  findMany: vi.fn().mockResolvedValue([]),
  createMany: vi.fn().mockResolvedValue({ count: 0 }),
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  // Нет строки в FeatureConfig = фича включена с дефолтами (см. featureConfig.ts).
  featureFindUnique: vi.fn().mockResolvedValue(null),
  featureUpsert: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    newsItem: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      createMany: mocks.createMany,
      deleteMany: mocks.deleteMany,
    },
    featureConfig: { findUnique: mocks.featureFindUnique, upsert: mocks.featureUpsert },
  },
}));

// Mock global fetch
vi.stubGlobal('fetch', vi.fn());

import {
  getNews,
  asLang,
  NEWS_SOURCES,
  getRetentionDays,
  setRetentionDays,
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
} from '@/lib/news';

describe('news module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([]);
    mocks.createMany.mockResolvedValue({ count: 0 });
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    mocks.featureFindUnique.mockResolvedValue(null);
    mocks.featureUpsert.mockResolvedValue({});
  });

  describe('asLang', () => {
    it('returns "ru" for ru', () => {
      expect(asLang('ru')).toBe('ru');
    });

    it('returns "en" for en', () => {
      expect(asLang('en')).toBe('en');
    });

    it('defaults to "en" for unknown/null/undefined', () => {
      expect(asLang('fr')).toBe('en');
      expect(asLang(null)).toBe('en');
      expect(asLang(undefined)).toBe('en');
    });
  });

  describe('NEWS_SOURCES', () => {
    it('defines EN and RU sources', () => {
      expect(Array.isArray(NEWS_SOURCES.en)).toBe(true);
      expect(Array.isArray(NEWS_SOURCES.ru)).toBe(true);
      expect(NEWS_SOURCES.en.length).toBeGreaterThan(0);
      expect(NEWS_SOURCES.ru.length).toBeGreaterThan(0);
    });

    it('each source has id/name/url', () => {
      for (const src of [...NEWS_SOURCES.en, ...NEWS_SOURCES.ru]) {
        expect(src).toHaveProperty('id');
        expect(src).toHaveProperty('name');
        expect(src.url).toMatch(/^https?:\/\//);
      }
    });
  });

  describe('getNews', () => {
    it('returns items, lang, sources for en', async () => {
      const res = await getNews({ lang: 'en' });
      expect(res.lang).toBe('en');
      expect(res.items).toEqual([]);
      expect(res.sources).toBe(NEWS_SOURCES.en);
    });

    it('returns items, lang, sources for ru', async () => {
      const res = await getNews({ lang: 'ru' });
      expect(res.lang).toBe('ru');
      expect(res.sources).toBe(NEWS_SOURCES.ru);
    });

    it('defaults to en and applies limit', async () => {
      mocks.findMany.mockResolvedValueOnce([
        { id: 'n1', lang: 'en', title: 't', url: 'u', publishedAt: new Date() },
      ]);
      const res = await getNews({ limit: 5 });
      expect(res.lang).toBe('en');
      expect(res.items).toHaveLength(1);
      const call = mocks.findMany.mock.calls[0][0];
      expect(call.take).toBe(5);
    });

    it('calls refresh when force=true', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<rss><channel><item><title>T</title><link>https://x.com/a</link></item></channel></rss>'),
      });
      vi.stubGlobal('fetch', fetchMock);
      const res = await getNews({ lang: 'en', force: true });
      expect(res.refreshed).toBeDefined();
      expect(fetchMock).toHaveBeenCalled();
    });

    it('returns cached items without waiting for the feeds when they are stale', async () => {
      mocks.findMany.mockResolvedValue([
        { id: 'n1', lang: 'ru', title: 't', url: 'u', publishedAt: new Date() },
      ]);
      // Фид, который никогда не отвечает: запрос всё равно должен вернуться.
      const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
      vi.stubGlobal('fetch', fetchMock);
      const res = await getNews({ lang: 'ru' });
      expect(res.items).toHaveLength(1);
      expect(res.refreshing).toBe(true);
      expect(res.refreshed).toEqual([]);
    });

    it('does not touch the feeds when the last attempt was recent', async () => {
      mocks.findMany.mockResolvedValue([
        { id: 'n1', lang: 'en', title: 't', url: 'u', publishedAt: new Date() },
      ]);
      mocks.featureFindUnique.mockResolvedValue({
        key: 'newsFeedState',
        enabled: true,
        config: JSON.stringify({ en: Date.now(), ru: Date.now() }),
      });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const res = await getNews({ lang: 'en' });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(res.refreshing).toBe(false);
    });

  });

  // RSS у трёх изданий размечен по-разному, поэтому парсер проверяем на
  // реальных вариантах разметки, а не на одном «идеальном» фиде.
  describe('parseFeed (через refresh)', () => {
    const feed = (items: string) =>
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(`<rss><channel>${items}</channel></rss>`),
      });

    const rowsFromLastInsert = () => mocks.createMany.mock.calls.at(-1)![0].data;

    it('strips CDATA, decodes entities and cuts tracking params off the URL', async () => {
      vi.stubGlobal(
        'fetch',
        feed(`<item>
            <title><![CDATA[Bitcoin &amp; Ethereum &#8212; up]]></title>
            <link>https://x.com/a?utm_source=rss&amp;utm_medium=feed</link>
            <description>&lt;p&gt;Текст с &quot;кавычками&quot;&lt;/p&gt;</description>
          </item>`),
      );
      await getNews({ lang: 'en', force: true });
      const [row] = rowsFromLastInsert();
      expect(row.title).toBe('Bitcoin & Ethereum — up');
      expect(row.url).toBe('https://x.com/a');
      expect(row.summary).toBe('Текст с "кавычками"');
    });

    it('falls back to guid when there is no link', async () => {
      vi.stubGlobal(
        'fetch',
        feed('<item><title>T</title><guid>https://x.com/from-guid</guid></item>'),
      );
      await getNews({ lang: 'en', force: true });
      expect(rowsFromLastInsert()[0].url).toBe('https://x.com/from-guid');
    });

    it('skips items without a title or a usable link', async () => {
      vi.stubGlobal(
        'fetch',
        feed(`<item><title></title><link>https://x.com/a</link></item>
              <item><title>No link</title></item>
              <item><title>Not a url</title><guid>tag:x.com,2026:1</guid></item>`),
      );
      await getNews({ lang: 'en', force: true });
      expect(mocks.createMany).not.toHaveBeenCalled();
    });

    it('drops duplicate links inside one feed', async () => {
      vi.stubGlobal(
        'fetch',
        feed(`<item><title>A</title><link>https://x.com/a</link></item>
              <item><title>A again</title><link>https://x.com/a?ref=2</link></item>`),
      );
      await getNews({ lang: 'en', force: true });
      expect(rowsFromLastInsert()).toHaveLength(1);
    });

    it('takes the image from media:content, media:thumbnail or enclosure', async () => {
      vi.stubGlobal(
        'fetch',
        feed(`<item><title>A</title><link>https://x.com/a</link>
                <media:thumbnail url="https://x.com/thumb.png" /></item>
              <item><title>B</title><link>https://x.com/b</link>
                <enclosure url="https://x.com/enc.png" type="image/png" /></item>
              <item><title>C</title><link>https://x.com/c</link></item>`),
      );
      await getNews({ lang: 'en', force: true });
      const rows = rowsFromLastInsert();
      expect(rows[0].imageUrl).toBe('https://x.com/thumb.png');
      expect(rows[1].imageUrl).toBe('https://x.com/enc.png');
      expect(rows[2].imageUrl).toBeNull();
    });

    it('falls back to «now» when pubDate is missing or unparsable', async () => {
      vi.stubGlobal(
        'fetch',
        feed(`<item><title>A</title><link>https://x.com/a</link>
                <pubDate>не дата</pubDate></item>
              <item><title>B</title><link>https://x.com/b</link></item>`),
      );
      const before = Date.now();
      await getNews({ lang: 'en', force: true });
      for (const row of rowsFromLastInsert()) {
        expect(row.publishedAt.getTime()).toBeGreaterThanOrEqual(before);
      }
    });

    it('reports an HTTP error per source instead of failing the whole refresh', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
      const res = await getNews({ lang: 'en', force: true });
      expect(res.refreshed.every((r) => r.error === 'HTTP 503')).toBe(true);
      expect(res.refreshed.every((r) => r.added === 0)).toBe(true);
    });
  });

  describe('getRetentionDays / setRetentionDays', () => {
    it('falls back to the default when nothing is saved', async () => {
      mocks.featureFindUnique.mockResolvedValue(null);
      expect(await getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
    });

    it('falls back to the default on a corrupt or negative value', async () => {
      mocks.featureFindUnique.mockResolvedValue({ key: 'newsFeed', enabled: true, config: 'not json' });
      expect(await getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
      mocks.featureFindUnique.mockResolvedValue({
        key: 'newsFeed',
        enabled: true,
        config: JSON.stringify({ retentionDays: -5 }),
      });
      expect(await getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
    });

    it('clamps what admin saves to 0..MAX and stores it', async () => {
      expect(await setRetentionDays(9999)).toBe(MAX_RETENTION_DAYS);
      expect(await setRetentionDays(-3)).toBe(0);
      expect(await setRetentionDays(5.7)).toBe(5);
      const lastCall = mocks.featureUpsert.mock.calls.at(-1)![0];
      expect(lastCall.where).toEqual({ key: 'newsFeed' });
      expect(JSON.parse(lastCall.update.config)).toEqual({ retentionDays: 5 });
    });
  });

  describe('retention', () => {
    it('deletes items older than retentionDays after a refresh', async () => {
      mocks.featureFindUnique.mockResolvedValue({
        key: 'newsFeed',
        enabled: true,
        config: JSON.stringify({ retentionDays: 3 }),
      });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('<rss></rss>') }),
      );
      await getNews({ lang: 'en', force: true });
      expect(mocks.deleteMany).toHaveBeenCalled();
      const cutoff = mocks.deleteMany.mock.calls[0][0].where.publishedAt.lt as Date;
      const days = (Date.now() - cutoff.getTime()) / 86_400_000;
      expect(days).toBeGreaterThan(2.9);
      expect(days).toBeLessThan(3.1);
    });

    it('deletes nothing when retentionDays is 0', async () => {
      mocks.featureFindUnique.mockResolvedValue({
        key: 'newsFeed',
        enabled: true,
        config: JSON.stringify({ retentionDays: 0 }),
      });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('<rss></rss>') }),
      );
      await getNews({ lang: 'en', force: true });
      expect(mocks.deleteMany).not.toHaveBeenCalled();
    });
  });
});
