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