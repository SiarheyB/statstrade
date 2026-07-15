import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the prisma module properly to avoid initialization errors
const mocks = vi.hoisted(() => ({
  tradeFindMany: vi.fn().mockResolvedValue([]),
  importedTradeFindMany: vi.fn().mockResolvedValue([]),
  exchangeAccountFindMany: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    trade: { findMany: mocks.tradeFindMany },
    importedTrade: { findMany: mocks.importedTradeFindMany },
    exchangeAccount: { findMany: mocks.exchangeAccountFindMany },
  },
}));

vi.mock('@/lib/analytics/metrics', () => ({
  computeMetrics: vi.fn().mockReturnValue({
    winRate: 0.5,
    profitFactor: 1.2,
    totalNetPnl: 100,
    expectancy: 10,
    maxDrawdownPct: 5,
    equityCurve: [],
    totalTrades: 10,
  }),
}));

import { computePublicSummary } from '@/lib/mentorShare';

describe('mentorShare module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tradeFindMany.mockResolvedValue([]);
    mocks.importedTradeFindMany.mockResolvedValue([]);
    mocks.exchangeAccountFindMany.mockResolvedValue([]);
  });

  it('returns default capital when no accounts found', async () => {
    const result = await computePublicSummary('user123');
    expect(result.totalTrades).toBe(0);
    expect(result.netPnl).toBe(100);
    expect(result.profitFactor).toBe(1.2);
    // With no accounts, computeMetrics is called with the default capital 10000
    const { computeMetrics } = await import('@/lib/analytics/metrics');
    expect(computeMetrics).toHaveBeenCalledWith(expect.any(Array), 10000);
  });

  it('includes first and last trade dates from data', async () => {
    // Mock the trade data
    mocks.tradeFindMany.mockResolvedValue([
      {
        id: 't1',
        accountId: 'acc1',
        symbol: 'BTC/USDT',
        base: 'BTC',
        quote: 'USDT',
        market: 'spot',
        exchange: 'bybit',
        side: 'buy',
        entryTime: new Date('2026-01-01T00:00:00Z'),
        exitTime: new Date('2026-01-01T01:00:00Z'),
        qty: 0.1,
        entryPrice: 50000,
        exitPrice: 52000,
        grossPnl: 200,
        fees: 5,
        netPnl: 195,
        returnPct: 0.0039,
        fillCount: 1,
        result: 'win',
      },
    ]);

    const result = await computePublicSummary('user123');
    expect(result.firstTradeAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.lastTradeAt).toBe('2026-01-01T01:00:00.000Z');
  });

  it('computes netPnl from metrics (default capital path)', async () => {
    // Mock the trade data
    mocks.tradeFindMany.mockResolvedValue([
      {
        id: 't1',
        accountId: 'acc1',
        symbol: 'BTC/USDT',
        base: 'BTC',
        quote: 'USDT',
        market: 'spot',
        exchange: 'bybit',
        side: 'sell',
        entryTime: new Date('2026-01-01T00:00:00Z'),
        exitTime: new Date('2026-01-02T00:00:00Z'),
        qty: 1,
        entryPrice: 50000,
        exitPrice: 52000,
        grossPnl: 2000,
        fees: 10,
        netPnl: 1990,
        returnPct: 0.04,
        fillCount: 1,
        result: 'win',
      },
    ]);

    const result = await computePublicSummary('user123');
    // netPnl comes from the mocked computeMetrics (totalNetPnl: 100)
    expect(result.netPnl).toBe(100);
    expect(result.totalTrades).toBe(1);
  });
});
