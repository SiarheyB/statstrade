import { describe, it, expect, beforeEach } from 'vitest';
import {
  asUser,
  asGuest,
  mockGetAuthUser,
} from '@/lib/__tests__/helpers/routeMocks';
import { GET } from '@/app/api/news/route';
import * as newsModule from '@/lib/news';

const base = 'https://example.com/api/news';

describe('GET /api/news', () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    newsModule.getNews.mockReset();
  });

  // Лента публичная: её читают лендинг и страница /news без регистрации.
  it('serves the feed to guests', async () => {
    asGuest();
    newsModule.getNews.mockResolvedValue({ items: [], lang: 'en', sources: [], refreshed: [] });
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
  });

  // Обход фидов — единственная тяжёлая операция роута, гостю она недоступна.
  it('ignores ?refresh=1 from a guest', async () => {
    asGuest();
    newsModule.getNews.mockResolvedValue({ items: [], lang: 'en', sources: [], refreshed: [] });
    await GET(new Request(`${base}?refresh=1`));
    expect(newsModule.getNews).toHaveBeenCalledWith(expect.objectContaining({ force: false }));
  });

  it('returns news items for authenticated user', async () => {
    asUser();
    newsModule.getNews.mockResolvedValue({
      items: [
        { id: '1', title: 'News 1', text: 'Content 1' },
        { id: '2', title: 'News 2', text: 'Content 2' },
      ],
      lang: 'en',
      sources: [],
      refreshed: [],
    });
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].id).toBe('1');
    expect(body.items[1].id).toBe('2');
  });

  it('reads the language from the query and defaults to en', async () => {
    asUser();
    newsModule.getNews.mockResolvedValue({ items: [], sources: [], lang: 'ru', refreshed: [] });
    await GET(new Request(`${base}?lang=ru`));
    expect(newsModule.getNews).toHaveBeenCalledWith({ force: false, lang: 'ru' });

    await GET(new Request(`${base}?lang=fr`));
    expect(newsModule.getNews).toHaveBeenCalledWith({ force: false, lang: 'en' });
  });

  it('caches a normal response but not a manual refresh', async () => {
    asUser();
    newsModule.getNews.mockResolvedValue({ items: [], sources: [], lang: 'en', refreshed: [] });
    const cached = await GET(new Request(base));
    expect(cached.headers.get('Cache-Control')).toContain('s-maxage');

    const fresh = await GET(new Request(`${base}?refresh=1`));
    expect(fresh.headers.get('Cache-Control')).toBeNull();
    expect(newsModule.getNews).toHaveBeenLastCalledWith({ force: true, lang: 'en' });
  });

  it('returns 500 when getNews throws', async () => {
    asUser();
    newsModule.getNews.mockRejectedValue(new Error('feed exploded'));
    const res = await GET(new Request(base));
    expect(res.status).toBe(500);
  });
});
