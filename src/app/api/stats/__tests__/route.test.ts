import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '../route';
import { Request } from 'undici';

let mockUser: { id: string } = { id: 'test-user' };

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...actual,
    prisma: {
      exchangeAccount: { findMany: vi.fn().mockResolvedValue([]) },
      trade: { findMany: vi.fn().mockResolvedValue([]) },
      fill: { count: vi.fn().mockResolvedValue(0) },
      importedTrade: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      tradeAnnotation: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn().mockImplementation(async (txs: any[]) => {
        for (const tx of txs) {
          if (typeof tx === 'function') await tx();
          else await tx;
        }
      }),
    },
  };
});

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    getAuthUser: vi.fn().mockImplementation(() => Promise.resolve(mockUser)),
    unauthorized: () => ({ status: 401, json: () => Promise.resolve({ error: 'Unauthorized' }) }),
    badRequest: (msg: string) => ({ status: 400, json: () => Promise.resolve({ error: msg }) }),
    serverError: (msg: string) => ({ status: 500, json: () => Promise.resolve({ error: msg }) }),
  };
});

vi.mock('@/lib/analytics/materialize', () => ({
  ensureAccountTrades: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/analytics/metrics', () => ({
  computeMetrics: vi.fn().mockReturnValue({ totalTrades: 0, winRate: 0, avgR: 0, profitFactor: 0, sharpe: 0, maxDrawdown: 0 }),
}));

vi.mock('@/lib/statsCache', () => ({
  getCached: vi.fn().mockReturnValue(undefined),
  setCached: vi.fn(),
  statsVersion: vi.fn().mockReturnValue(1),
}));

vi.mock('@/lib/format', () => ({
  canonSymbol: vi.fn().mockImplementation((s: string) => s.replace(/[^A-Z0-9]/g, '').toUpperCase()),
}));

describe('Stats API Integration Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('GET /stats returns 200 with metrics', async () => {
    const req = new Request('http://localhost/api/stats');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.json()).resolves.toHaveProperty('metrics');
  });

  it('GET /stats without auth returns 401', async () => {
    mockUser = null;

    const req = new Request('http://localhost/api/stats');
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });

    mockUser = { id: 'test-user' };
  });

  it('GET /stats with prisma query error returns 500', async () => {
    const { prisma } = await import('@/lib/db');
    prisma.exchangeAccount.findMany.mockRejectedValueOnce(new Error('DB error'));

    const req = new Request('http://localhost/api/stats');
    const res = await GET(req);

    expect(res.status).toBe(500);
    expect(res.json()).resolves.toEqual({ error: 'DB error' });
  });
});