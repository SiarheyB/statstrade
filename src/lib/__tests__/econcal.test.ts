import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks to avoid initialization errors
const mocks = vi.hoisted(() => ({
  upsertMock: vi.fn().mockResolvedValue({ id: 'test-id' }),
  findFirstMock: vi.fn().mockResolvedValue(null),
  findManyMock: vi.fn().mockResolvedValue([]),
  groupByMock: vi.fn().mockResolvedValue([]),
  deleteManyMock: vi.fn().mockResolvedValue({ count: 0 }),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    economicEvent: {
      upsert: mocks.upsertMock,
      findFirst: mocks.findFirstMock,
      findMany: mocks.findManyMock,
      groupBy: mocks.groupByMock,
      deleteMany: mocks.deleteManyMock,
    },
  },
}));

// Mock global fetch
const fakeFeedData = [
  {
    title: "Central Bank Interest Rate Decision",
    country: "USD",
    date: "2026-01-15T14:00:00Z",
    impact: "High",
    forecast: "4.5%",
    previous: "4.75%",
    actual: "4.50%",
  },
  {
    title: "CPI Inflation MoM",
    country: "EUR",
    date: "2026-01-15T10:00:00Z",
    impact: "Medium",
    forecast: "-0.2%",
    previous: "0.1%",
    actual: "-0.3%",
  },
];

vi.stubGlobal('fetch', vi.fn((url?: string) => {
  if (url?.includes('faireconomy')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(fakeFeedData),
    });
  }
  return Promise.resolve({ ok: false, status: 500 });
}));

// Import functions AFTER mocks are set up
import { countryFor, flagFor, refreshCalendar, getCalendar, pruneOldEvents } from '@/lib/econcal';

describe('econcal module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirstMock.mockResolvedValue(null);
    mocks.findManyMock.mockResolvedValue([]);
    mocks.upsertMock.mockResolvedValue({ id: 'test-id' });
    mocks.groupByMock.mockResolvedValue([]);
    mocks.deleteManyMock.mockResolvedValue({ count: 0 });
  });

  describe('countryFor', () => {
    it('returns full country name for known currency', () => {
      expect(countryFor('USD')).toBe('United States');
      expect(countryFor('EUR')).toBe('Euro Area');
    });

    it('returns input for unknown currency', () => {
      expect(countryFor('XYZ')).toBe('XYZ');
      expect(countryFor('')).toBe('');
    });
  });

  describe('flagFor', () => {
    it('returns EU flag for EU currency', () => {
      expect(flagFor('EUR')).toBe('🇪🇺');
    });

    it('returns regional indicator for known currencies', () => {
      expect(flagFor('USD')).toBe('🇺🇸');
      expect(flagFor('GBP')).toBe('🇬🇧');
    });

    it('returns fallback for unknown currency', () => {
      expect(flagFor('XYZ')).toBe('🏳️');
    });
  });

  describe('refreshCalendar', () => {
    it('refreshes calendar from feed and upserts events', async () => {
      const results = await refreshCalendar();
      expect(results).toHaveLength(1);
      expect(results[0].feed).toBe('ff_calendar_thisweek.json');
      expect(results[0].upserted).toBe(2);
      expect(results[0].error).toBeUndefined();
      expect(mocks.upsertMock).toHaveBeenCalledTimes(2);
    });

    it('handles fetch errors gracefully', async () => {
      // Override global fetch for this test
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      const results = await refreshCalendar();
      expect(results).toHaveLength(1);
      expect(results[0].upserted).toBe(0);
      expect(results[0].error).toBe('HTTP 500');
    });
  });

  describe('нормализация фида', () => {
    const feedOf = (items: unknown) =>
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(items) }),
      );

    const upserted = () => mocks.upsertMock.mock.calls.map((c) => c[0].create);

    it('skips rows without a title, currency or a valid date', async () => {
      feedOf([
        { title: '', country: 'USD', date: '2026-01-15T14:00:00Z' },
        { title: 'No currency', country: '', date: '2026-01-15T14:00:00Z' },
        { title: 'No date', country: 'USD' },
        { title: 'Bad date', country: 'USD', date: 'не дата' },
      ]);
      await refreshCalendar();
      expect(mocks.upsertMock).not.toHaveBeenCalled();
    });

    it('survives a feed that is not an array', async () => {
      feedOf({ error: 'rate limited' });
      const results = await refreshCalendar();
      expect(results[0].upserted).toBe(0);
      expect(results[0].error).toBeUndefined();
    });

    it('normalizes impact wording, including holidays', async () => {
      feedOf([
        { title: 'A', country: 'USD', date: '2026-01-15T14:00:00Z', impact: 'High' },
        { title: 'B', country: 'USD', date: '2026-01-15T14:00:00Z', impact: 'Medium' },
        { title: 'C', country: 'USD', date: '2026-01-15T14:00:00Z', impact: 'Low' },
        { title: 'D', country: 'USD', date: '2026-01-15T14:00:00Z', impact: 'Bank Holiday' },
        { title: 'E', country: 'USD', date: '2026-01-15T14:00:00Z' },
      ]);
      await refreshCalendar();
      expect(upserted().map((e) => e.impact)).toEqual([
        'high',
        'medium',
        'low',
        'holiday',
        'low',
      ]);
    });

    it('derives a category from the title and falls back to Other', async () => {
      feedOf([
        { title: 'Core CPI m/m', country: 'USD', date: '2026-01-15T14:00:00Z' },
        { title: 'Unemployment Claims', country: 'USD', date: '2026-01-15T14:00:00Z' },
        { title: 'Cash Rate', country: 'AUD', date: '2026-01-15T14:00:00Z' },
        { title: 'Flash GDP q/q', country: 'GBP', date: '2026-01-15T14:00:00Z' },
        { title: 'Bank Holiday', country: 'JPY', date: '2026-01-15T14:00:00Z' },
      ]);
      await refreshCalendar();
      expect(upserted().map((e) => e.category)).toEqual([
        'Inflation',
        'Employment',
        'Interest Rate',
        'GDP',
        'Other',
      ]);
    });

    it('turns blank forecast/previous/actual into null and maps the country', async () => {
      feedOf([
        {
          title: 'CPI y/y',
          country: 'eur',
          date: '2026-01-15T14:00:00Z',
          forecast: '  ',
          previous: '0.1%',
        },
      ]);
      await refreshCalendar();
      const [e] = upserted();
      expect(e.currency).toBe('EUR');
      expect(e.country).toBe('Euro Area');
      expect(e.forecast).toBeNull();
      expect(e.previous).toBe('0.1%');
      expect(e.actual).toBeNull();
    });
  });

  describe('getCalendar', () => {
    it('fetches events when stale', async () => {
      const results = await getCalendar({ force: true });
      expect(results.events).toHaveLength(0);
      expect(results.currencies).toHaveLength(0);
      expect(results.categories).toHaveLength(0);
    });

    it('returns facets for filter UI', async () => {
      mocks.findManyMock
        .mockResolvedValueOnce([]) // for events
        .mockResolvedValueOnce([]); // for facets
      const results = await getCalendar({});
      expect(results.events).toBeDefined();
      expect(results.currencies).toBeDefined();
      expect(results.categories).toBeDefined();
    });

    it('applies filters', async () => {
      mocks.findManyMock.mockResolvedValue([]);
      await getCalendar({ currencies: ['USD'], category: 'Interest Rate' });
      expect(mocks.findManyMock).toHaveBeenCalled();
    });

    it('builds the where clause from every filter it was given', async () => {
      const from = new Date('2026-01-12T00:00:00Z');
      const to = new Date('2026-01-19T00:00:00Z');
      await getCalendar({
        from,
        to,
        currencies: ['USD', 'EUR'],
        impacts: ['high'],
        category: 'Inflation',
      });
      const { where } = mocks.findManyMock.mock.calls[0][0];
      expect(where).toEqual({
        time: { gte: from, lte: to },
        currency: { in: ['USD', 'EUR'] },
        impact: { in: ['high'] },
        category: 'Inflation',
      });
    });

    it('leaves the where clause empty when no filters are set', async () => {
      await getCalendar({});
      expect(mocks.findManyMock.mock.calls[0][0].where).toEqual({});
    });

    it('accepts a one-sided date window', async () => {
      const from = new Date('2026-01-12T00:00:00Z');
      await getCalendar({ from });
      expect(mocks.findManyMock.mock.calls[0][0].where.time).toEqual({ gte: from });
    });

    it('ignores empty filter arrays', async () => {
      await getCalendar({ currencies: [], impacts: [] });
      expect(mocks.findManyMock.mock.calls[0][0].where).toEqual({});
    });

    it('builds facets without loading the whole table', async () => {
      mocks.groupByMock
        .mockResolvedValueOnce([{ currency: 'USD' }, { currency: 'EUR' }])
        .mockResolvedValueOnce([{ category: 'Inflation' }, { category: null }]);
      const results = await getCalendar({});
      expect(results.currencies).toEqual(['EUR', 'USD']);
      expect(results.categories).toEqual(['Inflation']);
      expect(mocks.groupByMock).toHaveBeenCalledTimes(2);
    });
  });

  // Чистка привязана к границе недели: как только начался понедельник,
  // события прошлых недель уходят сами (плюс сутки запаса на часовые пояса).
  describe('pruneOldEvents', () => {
    const cutoffFor = async (now: Date) => {
      mocks.deleteManyMock.mockClear();
      await pruneOldEvents(now);
      return mocks.deleteManyMock.mock.calls[0][0].where.time.lt as Date;
    };

    it('cuts at Monday 00:00 UTC of the current week minus a day of slack', async () => {
      // Среда, 12 августа 2026 → понедельник недели = 10 августа.
      const cutoff = await cutoffFor(new Date('2026-08-12T15:00:00Z'));
      expect(cutoff.toISOString()).toBe('2026-08-09T00:00:00.000Z');
    });

    it('treats Sunday as the last day of the current week, not the first', async () => {
      // Воскресенье 16 августа принадлежит неделе, начавшейся 10 августа —
      // события этой недели удалять ещё рано.
      const cutoff = await cutoffFor(new Date('2026-08-16T23:00:00Z'));
      expect(cutoff.toISOString()).toBe('2026-08-09T00:00:00.000Z');
    });

    it('moves the cut forward once the new week starts on Monday', async () => {
      const cutoff = await cutoffFor(new Date('2026-08-17T00:30:00Z'));
      expect(cutoff.toISOString()).toBe('2026-08-16T00:00:00.000Z');
    });

    it('runs after every calendar refresh', async () => {
      await getCalendar({ force: true });
      expect(mocks.deleteManyMock).toHaveBeenCalled();
    });
  });
});