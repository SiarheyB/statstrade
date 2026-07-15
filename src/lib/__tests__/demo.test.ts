import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks to avoid initialization errors
const mocks = vi.hoisted(() => ({
  createMany: vi.fn().mockResolvedValue({ count: 0 }),
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  update: vi.fn().mockResolvedValue({}),
  findUnique: vi.fn().mockResolvedValue({
    entryPointOptions: null,
    entryTypeOptions: null,
    mistakeOptions: null,
    patternOptions: null,
  }),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    fill: { createMany: mocks.createMany, deleteMany: mocks.deleteMany },
    tradeAnnotation: { createMany: mocks.createMany, deleteMany: mocks.deleteMany },
    user: { findUnique: mocks.findUnique },
    exchangeAccount: { update: mocks.update },
  },
}));

// Mock analytics modules
vi.mock('@/lib/analytics/materialize', () => ({
  rebuildAccountTrades: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/analytics/positions', () => ({
  reconstructTrades: vi.fn().mockReturnValue([
    {
      id: 'trade-1',
      side: 'long',
      entryPrice: 60000,
      exitPrice: 62000,
      result: 'win',
    },
    {
      id: 'trade-2',
      side: 'short',
      entryPrice: 3000,
      exitPrice: 3100,
      result: 'loss',
    },
  ]),
}));

vi.mock('@/lib/annotations', () => ({
  parseOptions: vi.fn((val, def) => (val ? val.split(',') : def)),
  DEFAULT_ENTRY_POINTS: ['breakout', 'pullback'],
  DEFAULT_ENTRY_TYPES: ['market', 'limit'],
  DEFAULT_MISTAKES: ['late-entry', 'early-exit'],
  DEFAULT_PATTERNS: ['trend', 'reversal'],
}));

// Import functions AFTER mocks are set up
import { generateDemoFills, seedDemoData } from '@/lib/demo';

describe('demo module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      entryPointOptions: null,
      entryTypeOptions: null,
      mistakeOptions: null,
      patternOptions: null,
    });
  });

  describe('generateDemoFills', () => {
    it('generates correct number of fill rows (2 per trade)', () => {
      const rows = generateDemoFills('acc1', 'bybit', 10);
      expect(rows).toHaveLength(20); // open + close for each trade
    });

    it('each fill has required fields', () => {
      const rows = generateDemoFills('acc1', 'bybit', 5);
      for (const r of rows) {
        expect(r).toHaveProperty('accountId', 'acc1');
        expect(r).toHaveProperty('exchange', 'bybit');
        expect(r).toHaveProperty('tradeId');
        expect(r).toHaveProperty('symbol');
        expect(r).toHaveProperty('base');
        expect(r).toHaveProperty('quote');
        expect(r).toHaveProperty('market');
        expect(r).toHaveProperty('side');
        expect(typeof r.price).toBe('number');
        expect(typeof r.amount).toBe('number');
        expect(typeof r.cost).toBe('number');
        expect(typeof r.fee).toBe('number');
        expect(r).toHaveProperty('feeCurrency');
        expect(r).toHaveProperty('takerOrMaker');
        expect(r.timestamp).toBeInstanceOf(Date);
      }
    });

    it('open fills have null realizedPnl, close fills have numeric realizedPnl', () => {
      const rows = generateDemoFills('acc1', 'bybit', 5);
      for (let i = 0; i < rows.length; i += 2) {
        expect(rows[i].realizedPnl).toBeNull();
        expect(typeof rows[i + 1].realizedPnl).toBe('number');
      }
    });

    it('generates both swap and spot symbols', () => {
      const rows = generateDemoFills('acc1', 'bybit', 100);
      const symbols = new Set(rows.map(r => r.symbol));
      const hasSwap = [...symbols].some(s => s.includes(':'));
      const hasSpot = [...symbols].some(s => !s.includes(':'));
      expect(hasSwap).toBe(true);
      expect(hasSpot).toBe(true);
    });

    it('entry and exit sides are opposite', () => {
      const rows = generateDemoFills('acc1', 'bybit', 10);
      for (let i = 0; i < rows.length; i += 2) {
        const openSide = rows[i].side;
        const closeSide = rows[i + 1].side;
        expect(openSide).not.toBe(closeSide);
        expect(['buy', 'sell']).toContain(openSide);
        expect(['buy', 'sell']).toContain(closeSide);
      }
    });

    it('timestamps are within lookback window and exit after entry', () => {
      const now = Date.now();
      const lookbackDays = 30;
      const rows = generateDemoFills('acc1', 'bybit', 20, lookbackDays);
      for (let i = 0; i < rows.length; i += 2) {
        const entry = rows[i].timestamp.getTime();
        const exit = rows[i + 1].timestamp.getTime();
        expect(entry).toBeLessThanOrEqual(now);
        expect(entry).toBeGreaterThan(now - lookbackDays * 24 * 3600 * 1000);
        expect(exit).toBeGreaterThan(entry);
      }
    });
  });

  describe('seedDemoData', () => {
    it('deletes old demo fills and annotations before seeding', async () => {
      await seedDemoData('acc1', 'bybit', 'user1');
      expect(mocks.deleteMany).toHaveBeenCalledTimes(2);
      expect(mocks.deleteMany).toHaveBeenCalledWith({
        where: { accountId: 'acc1', tradeId: { startsWith: 'demo-' } },
      });
      expect(mocks.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user1', tradeKey: { startsWith: 'acc1:' } },
      });
    });

    it('creates fills and rebuilds account trades', async () => {
      const count = await seedDemoData('acc1', 'bybit', 'user1');
      expect(mocks.createMany).toHaveBeenCalledTimes(2); // fills + annotations
      expect(count).toBeGreaterThan(0);
    });

    it('sets account balance to 10000', async () => {
      await seedDemoData('acc1', 'bybit', 'user1');
      expect(mocks.update).toHaveBeenCalledWith({
        where: { id: 'acc1' },
        data: { balance: 10000, balanceAt: expect.any(Date) },
      });
    });

    it('attaches annotations to trades with valid keys', async () => {
      await seedDemoData('acc1', 'bybit', 'user1');
      const annotationCalls = mocks.createMany.mock.calls.filter(c =>
        c[0]?.data?.some?.((d: any) => d.userId === 'user1')
      );
      expect(annotationCalls.length).toBeGreaterThan(0);
      const data = annotationCalls[0][0].data;
      for (const a of data) {
        expect(a).toHaveProperty('userId', 'user1');
        expect(a).toHaveProperty('tradeKey');
        // At least one annotation field should be present (check != null, not just truthy)
        const hasAnnotation = a.entryPoint != null || a.entryType != null || a.mistake != null || a.pattern != null || a.stopLoss != null;
        expect(hasAnnotation).toBe(true);
      }
    });
  });
});