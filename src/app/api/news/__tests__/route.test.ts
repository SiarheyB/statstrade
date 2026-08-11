import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  asUser,
  asGuest,
  mockGetAuthUser,
} from '@/lib/__tests__/helpers/routeMocks';
import { GET } from '@/app/api/news/route';
import * as newsModule from '@/lib/news';
import { getFeatureConfig } from '@/lib/featureConfig';

const base = 'https://example.com/api/news';

describe('GET /api/news', () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    newsModule.getNews.mockReset();
    vi.mocked(getFeatureConfig).mockResolvedValue({ enabled: true, retentionDays: 2 } as never);
  });

  it('returns 401 when not authenticated', async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
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

  it('returns 403 when the news feature is disabled in admin', async () => {
    asUser();
    vi.mocked(getFeatureConfig).mockResolvedValueOnce({ enabled: false, retentionDays: 2 } as never);
    const res = await GET(new Request(base));
    expect(res.status).toBe(403);
    expect(newsModule.getNews).not.toHaveBeenCalled();
  });
});