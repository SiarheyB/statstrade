import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks to avoid initialization errors
const mocks = vi.hoisted(() => ({
  upsertMock: vi.fn().mockResolvedValue({ id: 'test-id' }),
  findFirstMock: vi.fn().mockResolvedValue(null),
  findManyMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    economicEvent: {
      upsert: mocks.upsertMock,
      findFirst: mocks.findFirstMock,
      findMany: mocks.findManyMock,
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
import { countryFor, flagFor, refreshCalendar, getCalendar } from '@/lib/econcal';

describe('econcal module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirstMock.mockResolvedValue(null);
    mocks.findManyMock.mockResolvedValue([]);
    mocks.upsertMock.mockResolvedValue({ id: 'test-id' });
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
  });
});