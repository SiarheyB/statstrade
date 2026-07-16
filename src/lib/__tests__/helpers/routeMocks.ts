import { vi } from 'vitest';

/*
 * Shared mocks for API route handlers (integration tests).
 *
 * These mocks are applied globally via vi.mock() calls so that API route tests
 * can run without a real backend. They override implementations while preserving
 * the expected module structure.
 *
 * NOTE: featureConfig / news / exchangeToggle are mocked with a plain object
 * (no importOriginal) because their underlying modules pull in heavy deps that
 * crash under vitest (prisma, ccxt). The route handlers only touch the few
 * functions listed here, so a partial mock is enough.
 */

/* --- Auth control handles (call from tests to set the resolved session) --- */
export const mockGetAuthUser = vi.fn();
export const mockGetAdminSession = vi.fn();
export const mockRecordAudit = vi.fn();

export function asUser(over: Record<string, unknown> = {}) {
  mockGetAuthUser.mockResolvedValue({ userId: 'u1', email: 'user@example.com', ...over });
}

export function asGuest() {
  mockGetAuthUser.mockResolvedValue(null);
}

export function asAdmin(over: Record<string, unknown> = {}) {
  mockGetAdminSession.mockResolvedValue({ userId: 'a1', email: 'admin@example.com', ...over });
}

export function asNonAdmin() {
  mockGetAdminSession.mockResolvedValue(null);
}

/* --- Prisma mock: nested vi.fns with safe defaults; override per test --- */
export const mockPrisma = {
  $queryRaw: vi.fn().mockResolvedValue([]),
  $queryRawUnsafe: vi.fn().mockResolvedValue([{ n: 0 }]),
  $executeRaw: vi.fn().mockResolvedValue(0),

  collectorConfig: {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },

  exchangeAccount: { findMany: vi.fn().mockResolvedValue([]) },
  trade: { findMany: vi.fn().mockResolvedValue([]) },

  fill: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
  },

  riskProfile: { findMany: vi.fn().mockResolvedValue([]) },

  importedTrade: { findMany: vi.fn().mockResolvedValue([]) },

  user: {
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  },

  tradeAnnotation: { findMany: vi.fn().mockResolvedValue([]) },

  adminAudit: { create: vi.fn().mockResolvedValue({}) },

  errorLog: { create: vi.fn().mockResolvedValue({}) },
};

/* --- Core module mocks (auth / admin / db) --- */

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getAuthUser: (...a: unknown[]) => mockGetAuthUser(...a),
}));

vi.mock('@/lib/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin')>()),
  getAdminSession: (...a: unknown[]) => mockGetAdminSession(...a),
  recordAudit: (...a: unknown[]) => mockRecordAudit(...a),
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

/* --- Module-level mocks --- */

/* NOTE: @/lib/analytics/positions and @/lib/risk are NOT mocked here — the
 * risk route test (src/app/api/risk/__tests__/route.test.ts) provides its own
 * detailed vi.mock with mockImplementation for those two modules. */

/* featureConfig: route only calls getFeatureConfig */
vi.mock('@/lib/featureConfig', () => ({
  getFeatureConfig: vi.fn(),
}));

/* news: route only calls getNews + asLang; asLang is pure, keep the real impl */
vi.mock('@/lib/news', async () => {
  const mod = await vi.importActual<typeof import('@/lib/news')>('@/lib/news');
  return {
    ...mod,
    getNews: vi.fn(),
  };
});

/* exchangeToggle: route only calls getEnabledExchangeMetas; the real module
 * pulls in ccxt via ./exchanges, so we mock the whole module without importing it. */
vi.mock('@/lib/exchangeToggle', () => ({
  getEnabledExchangeMetas: vi.fn(),
}));
