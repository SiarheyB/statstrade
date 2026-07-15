import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncChunk } from '@/lib/sync';

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
  decrypt: vi.fn(),
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