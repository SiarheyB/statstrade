import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncChunk, persistFills, runDueSyncs, kickUserSync } from '@/lib/sync';

// Mock database and external modules for sync testing
vi.mock('@/lib/db', () => ({
  prisma: {
    exchangeAccount: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    fill: {
      createMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/exchanges', () => ({
  createExchange: vi.fn(),
  fetchBalanceUsdt: vi.fn(),
  loadMarkets: vi.fn(),
  normalizeFill: vi.fn(),
  isExchangeId: vi.fn(() => true),
}));

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn((s: string) => s),
}));

vi.mock('@/lib/statsCache', () => ({
  bumpStatsVersion: vi.fn(),
}));

vi.mock('@/lib/analytics/materialize', () => ({
  rebuildTradeGroups: vi.fn(),
}));

vi.mock('@/lib/feeConvert', () => ({
  convertUnknownFees: vi.fn(),
}));

vi.mock('@/lib/ratelimit', () => ({
  clientIp: vi.fn(),
}));

describe('syncChunk core functionality', () => {
  let prisma: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@/lib/db');
    prisma = db.prisma;
  });

  it('starts new scan when account has no syncPlan', async () => {
    // Use Bybit which doesn't require per-symbol enumeration, so buildPlan
    // returns a valid task list and the scan starts properly
    vi.mocked(prisma.exchangeAccount.findUnique).mockResolvedValue({
      id: 'acc123',
      exchange: 'bybit',
      marketType: 'spot',
      syncStatus: 'idle',
      syncPlan: null,
      syncCursor: 0,
      syncTotal: 0,
      syncImported: 0,
      syncPhase: null,
      syncError: null,
      lastSyncAt: new Date('2024-01-01T00:00:00Z'),
      fullSyncAt: null,
      balance: null,
      balanceAt: null,
      demoTrading: false,
      autoSync: true,
      syncIntervalMinutes: 60,
      apiKey: 'key',
      apiSecret: 'secret',
      passphrase: null,
    });

    const result = await syncChunk('acc123');
    expect(result.status).toBe('syncing');
    expect(result.phase).toBe('full');
  });

  it('resets sync state when rescan=true', async () => {
    vi.mocked(prisma.exchangeAccount.findUnique).mockResolvedValue({
      id: 'acc123',
      exchange: 'bybit',
      marketType: 'spot',
      syncStatus: 'syncing',
      syncPlan: '["spot|BTC/USDT"]',
      syncCursor: 5,
      syncTotal: 20,
      syncImported: 10,
      syncPhase: 'full',
      syncError: null,
      lastSyncAt: new Date('2024-01-01T00:00:00Z'),
      fullSyncAt: new Date('2024-02-01T00:00:00Z'),
      balance: null,
      balanceAt: null,
      demoTrading: false,
      autoSync: true,
      syncIntervalMinutes: 60,
      apiKey: 'key',
      apiSecret: 'secret',
      passphrase: null,
    });

    vi.mocked(prisma.exchangeAccount.update).mockResolvedValue(undefined);

    await syncChunk('acc123', { rescan: true });

    expect(prisma.exchangeAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acc123' },
        data: expect.objectContaining({
          syncStatus: 'idle',
          syncPlan: null,
          syncCursor: 0,
          syncTotal: 0,
          syncImported: 0,
          syncPhase: null,
          fullSyncAt: null,
        }),
      }),
    );
  });
});

describe('persistFills', () => {
  let prisma: any;
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@/lib/db');
    prisma = db.prisma;
  });

  function fill(over: Record<string, unknown> = {}) {
    return {
      tradeId: 't1',
      orderId: 'o1',
      symbol: 'BTC/USDT',
      base: 'BTC',
      quote: 'USDT',
      market: 'spot',
      side: 'buy',
      price: 50000,
      amount: 0.1,
      cost: 5000,
      fee: 5,
      feeCurrency: 'USDT',
      realizedPnl: 0,
      takerOrMaker: 'taker',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      ...over,
    } as any;
  }

  it('возвращает 0 для пустого массива, не трогает БД', async () => {
    const n = await persistFills('acc1', 'binance', []);
    expect(n).toBe(0);
    expect(prisma.fill.createMany).not.toHaveBeenCalled();
  });

  it('вставляет уникальные филлы и материализует затронутые группы', async () => {
    prisma.fill.createMany.mockResolvedValue({ count: 2 });
    const mat = await import('@/lib/analytics/materialize');
    const n = await persistFills('acc1', 'binance', [
      fill({ tradeId: 't1', symbol: 'BTC/USDT', market: 'spot' }),
      fill({ tradeId: 't2', symbol: 'ETH/USDT', market: 'spot' }),
    ]);
    expect(n).toBe(2);
    expect(prisma.fill.createMany).toHaveBeenCalledOnce();
    // rebuildTradeGroups вызван с двумя группами
    expect(mat.rebuildTradeGroups).toHaveBeenCalledOnce();
    const groups = mat.rebuildTradeGroups.mock.calls[0][1];
    expect(groups).toHaveLength(2);
  });

  it('дедуплицирует филлы внутри батча по symbol:tradeId', async () => {
    prisma.fill.createMany.mockResolvedValue({ count: 1 });
    await persistFills('acc1', 'binance', [
      fill({ tradeId: 't1', symbol: 'BTC/USDT' }),
      fill({ tradeId: 't1', symbol: 'BTC/USDT' }), // дубль
    ]);
    const rows = prisma.fill.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
  });

  it('не материализует, если ничего нового не вставлено (count=0)', async () => {
    prisma.fill.createMany.mockResolvedValue({ count: 0 });
    const mat = await import('@/lib/analytics/materialize');
    const n = await persistFills('acc1', 'binance', [fill()]);
    expect(n).toBe(0);
    expect(mat.rebuildTradeGroups).not.toHaveBeenCalled();
  });
});

describe('runDueSyncs', () => {
  let prisma: any;
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@/lib/db');
    prisma = db.prisma;
  });

  it('пустой список аккаунтов → due=0', async () => {
    prisma.exchangeAccount.findMany.mockResolvedValue([]);
    const res = await runDueSyncs();
    expect(res).toEqual({ due: 0, advanced: [], failed: [] });
  });

  it('аккаунт без lastSyncAt считается due', async () => {
    const now = Date.now();
    prisma.exchangeAccount.findMany.mockResolvedValue([
      {
        id: 'a1',
        syncStatus: 'idle',
        lastSyncAt: null,
        syncIntervalMinutes: 60,
        user: { lastSeenAt: new Date(now) },
      },
    ]);
    const res = await runDueSyncs();
    expect(res.due).toBe(1);
  });

  it('недавно синхронизированный активный аккаунт не due', async () => {
    const now = Date.now();
    prisma.exchangeAccount.findMany.mockResolvedValue([
      {
        id: 'a1',
        syncStatus: 'idle',
        lastSyncAt: new Date(now - 60_000), // 1 мин назад
        syncIntervalMinutes: 60, // интервал 60 мин
        user: { lastSeenAt: new Date(now) },
      },
    ]);
    const res = await runDueSyncs();
    expect(res.due).toBe(0);
  });

  it('аккаунт в статусе syncing всегда due', async () => {
    const now = Date.now();
    prisma.exchangeAccount.findMany.mockResolvedValue([
      {
        id: 'a1',
        syncStatus: 'syncing',
        lastSyncAt: new Date(now),
        syncIntervalMinutes: 60,
        user: { lastSeenAt: new Date(now) },
      },
    ]);
    const res = await runDueSyncs();
    expect(res.due).toBe(1);
  });
});

describe('kickUserSync', () => {
  let prisma: any;
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('@/lib/db');
    prisma = db.prisma;
  });

  it('не бросает исключений (fire-and-forget) и запрашивает аккаунты юзера', () => {
    prisma.exchangeAccount.findMany.mockResolvedValue([]);
    expect(() => kickUserSync('u1')).not.toThrow();
    expect(prisma.exchangeAccount.findMany).toHaveBeenCalled();
  });
});