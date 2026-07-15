import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks to avoid initialization errors
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn().mockResolvedValue(null),
  findMany: vi.fn().mockResolvedValue([]),
  createMany: vi.fn().mockResolvedValue({ count: 0 }),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    newsItem: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      createMany: mocks.createMany,
    },
  },
}));

// Mock global fetch
vi.stubGlobal('fetch', vi.fn());

import { getNews, asLang, NEWS_SOURCES } from '@/lib/news';

describe('news module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([]);
    mocks.createMany.mockResolvedValue({ count: 0 });
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
  });
});
