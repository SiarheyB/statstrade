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

export function asNonUser() {
  mockGetAuthUser.mockResolvedValue(null);
}

/* --- Prisma mock: nested vi.fns with safe defaults; override per test --- */
export const mockPrisma = {
  $queryRaw: vi.fn().mockResolvedValue([]),
  $queryRawUnsafe: vi.fn().mockResolvedValue([{ n: 0 }]),
  $transaction: vi.fn((args: unknown) => {
    if (Array.isArray(args)) return Promise.all(args as Promise<unknown>[]);
    return Promise.resolve([]);
  }),
  $executeRaw: vi.fn().mockResolvedValue(0),

  collectorConfig: {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },

  exchangeAccount: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
  trade: { findMany: vi.fn().mockResolvedValue([]) },

  fill: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
  },

  riskProfile: {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },

  importedTrade: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },

  user: {
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  },

  tradeAnnotation: {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
  },

  adminAudit: { create: vi.fn().mockResolvedValue({}) },

  errorLog: {
    create: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },

  // --- Models used by admin / support / playbooks / share-links route tests ---
  donateWallet: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
  },

  exchangeToggle: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },

  playbook: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },

  shareLink: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },

  supportTicket: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },

  supportMessage: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
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

/* featureConfig: routes call getFeatureConfig / setFeatureConfig / getAllFeatureConfigs */
vi.mock('@/lib/featureConfig', () => ({
  getFeatureConfig: vi.fn(),
  setFeatureConfig: vi.fn(),
  getAllFeatureConfigs: vi.fn(),
}));

/* news: routes call getNews / refreshNews + asLang; asLang is pure, keep real */
vi.mock('@/lib/news', async () => {
  const mod = await vi.importActual<typeof import('@/lib/news')>('@/lib/news');
  return {
    ...mod,
    getNews: vi.fn(),
    refreshNews: vi.fn(),
  };
});

/* exchangeToggle: routes call getEnabledExchangeMetas / isExchangeEnabled /
 * getAllExchangeToggles; the real module pulls in ccxt via ./exchanges, so we
 * mock the whole module. */
export const mockExchangeToggle = {
  getEnabledExchangeMetas: vi.fn().mockResolvedValue([]),
  isExchangeEnabled: vi.fn(async () => true),
  getAllExchangeToggles: vi.fn().mockResolvedValue([]),
};
vi.mock('@/lib/exchangeToggle', () => ({
  getEnabledExchangeMetas: mockExchangeToggle.getEnabledExchangeMetas,
  isExchangeEnabled: mockExchangeToggle.isExchangeEnabled,
  getAllExchangeToggles: mockExchangeToggle.getAllExchangeToggles,
}));
