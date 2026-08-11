import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks to avoid initialization errors
const mocks = vi.hoisted(() => ({
  upsertMock: vi.fn().mockResolvedValue({ id: 'test-id' }),
  findFirstMock: vi.fn().mockResolvedValue(null),
  findManyMock: vi.fn().mockResolvedValue([]),
  groupByMock: vi.fn().mockResolvedValue([]),
  deleteManyMock: vi.fn().mockResolvedValue({ count: 0 }),
  // Нет строки в FeatureConfig = фича включена с дефолтами (см. featureConfig.ts).
  featureFindUnique: vi.fn().mockResolvedValue(null),
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
    featureConfig: { findUnique: mocks.featureFindUnique },
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
import { countryFor, flagFor, refreshCalendar, getCalendar } from '@/lib/econcal';

describe('econcal module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirstMock.mockResolvedValue(null);
    mocks.findManyMock.mockResolvedValue([]);
    mocks.upsertMock.mockResolvedValue({ id: 'test-id' });
    mocks.groupByMock.mockResolvedValue([]);
    mocks.deleteManyMock.mockResolvedValue({ count: 0 });
    mocks.featureFindUnique.mockResolvedValue(null);
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

    it('does not touch the feed when the feature is disabled', async () => {
      mocks.featureFindUnique.mockResolvedValue({ key: 'econcalFeed', enabled: false, config: null });
      const results = await getCalendar({ force: true });
      expect(mocks.upsertMock).not.toHaveBeenCalled();
      expect(mocks.deleteManyMock).not.toHaveBeenCalled();
      expect(results.refreshed).toEqual([]);
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

  describe('retention', () => {
    it('deletes past events older than retentionDays after a refresh', async () => {
      mocks.featureFindUnique.mockResolvedValue({
        key: 'econcalFeed',
        enabled: true,
        config: JSON.stringify({ retentionDays: 10 }),
      });
      await getCalendar({ force: true });
      expect(mocks.deleteManyMock).toHaveBeenCalled();
      const cutoff = mocks.deleteManyMock.mock.calls[0][0].where.time.lt as Date;
      const days = (Date.now() - cutoff.getTime()) / 86_400_000;
      expect(days).toBeGreaterThan(9.9);
      expect(days).toBeLessThan(10.1);
    });

    it('deletes nothing when retentionDays is 0', async () => {
      mocks.featureFindUnique.mockResolvedValue({
        key: 'econcalFeed',
        enabled: true,
        config: JSON.stringify({ retentionDays: 0 }),
      });
      await getCalendar({ force: true });
      expect(mocks.deleteManyMock).not.toHaveBeenCalled();
    });
  });
});