import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// getSession дергает next/headers cookies() — мокаем, чтобы getAdminSession
// не падал вне request scope.
const { mockGetSession, mockQueryRaw, mockAuditCreate } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockQueryRaw: vi.fn(),
  mockAuditCreate: vi.fn(),
}));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    getSession: () => mockGetSession(),
  };
});

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: mockQueryRaw,
    adminAudit: { create: mockAuditCreate },
  },
}));

import {
  isAdminEmail,
  isAdminSession,
  getAdminSession,
  notFound,
  getFeedFreshness,
  recordAudit,
  ONLINE_THRESHOLD_MS,
  FEED_STALE_MS,
} from '@/lib/admin';

describe('admin', () => {
  const OLD_ENV = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'boss@example.com, Admin@Example.com';
    mockGetSession.mockReset();
    mockQueryRaw.mockReset();
    mockAuditCreate.mockReset();
  });

  afterEach(() => {
    process.env.ADMIN_EMAILS = OLD_ENV;
  });

  describe('isAdminEmail', () => {
    it('распознаёт админский email без учёта регистра', () => {
      expect(isAdminEmail('boss@example.com')).toBe(true);
      expect(isAdminEmail('BOSS@EXAMPLE.COM')).toBe(true);
      expect(isAdminEmail('admin@example.com')).toBe(true);
    });

    it('отклоняет не-админов и пустые значения', () => {
      expect(isAdminEmail('user@example.com')).toBe(false);
      expect(isAdminEmail('')).toBe(false);
      expect(isAdminEmail(undefined)).toBe(false);
      expect(isAdminEmail(null)).toBe(false);
    });

    it('возвращает false, когда ADMIN_EMAILS не задан', () => {
      delete process.env.ADMIN_EMAILS;
      expect(isAdminEmail('boss@example.com')).toBe(false);
    });
  });

  describe('isAdminSession', () => {
    it('true для админской сессии', () => {
      expect(isAdminSession({ userId: '1', email: 'boss@example.com' })).toBe(true);
    });

    it('false для обычной сессии и null', () => {
      expect(isAdminSession({ userId: '2', email: 'user@example.com' })).toBe(false);
      expect(isAdminSession(null)).toBe(false);
    });
  });

  describe('getAdminSession', () => {
    it('возвращает сессию, если пользователь — админ', async () => {
      const session = { userId: '1', email: 'boss@example.com' };
      mockGetSession.mockResolvedValue(session);
      await expect(getAdminSession()).resolves.toEqual(session);
    });

    it('возвращает null для не-админа', async () => {
      mockGetSession.mockResolvedValue({ userId: '2', email: 'user@example.com' });
      await expect(getAdminSession()).resolves.toBeNull();
    });

    it('возвращает null, если сессии нет', async () => {
      mockGetSession.mockResolvedValue(null);
      await expect(getAdminSession()).resolves.toBeNull();
    });
  });

  describe('notFound', () => {
    it('отдаёт ответ со статусом 404', async () => {
      const res = notFound();
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ error: 'Not found' });
    });
  });

  describe('константы', () => {
    it('ONLINE_THRESHOLD_MS = 10 минут', () => {
      expect(ONLINE_THRESHOLD_MS).toBe(10 * 60_000);
    });

    it('FEED_STALE_MS = 90 секунд', () => {
      expect(FEED_STALE_MS).toBe(90_000);
    });
  });

  describe('getFeedFreshness', () => {
    it('собирает свежесть по фидам и помечает отставшие', async () => {
      const now = Date.now();
      mockQueryRaw
        .mockResolvedValueOnce([{ symbol: 'BTCUSDT', exchange: 'binance' }])
        .mockResolvedValueOnce([{ last_t: new Date(now - 1000) }]); // свежий

      const out = await getFeedFreshness();
      expect(out).toHaveLength(1);
      expect(out[0].symbol).toBe('BTCUSDT');
      expect(out[0].exchange).toBe('binance');
      expect(out[0].stale).toBe(false);
      expect(out[0].lagMs).toBeCloseTo(1000, -1);
    });

    it('помечает фид как stale при большом лаге', async () => {
      const now = Date.now();
      mockQueryRaw
        .mockResolvedValueOnce([{ symbol: 'ETHUSDT', exchange: 'bybit' }])
        .mockResolvedValueOnce([{ last_t: new Date(now - 200_000) }]);

      const out = await getFeedFreshness();
      expect(out[0].stale).toBe(true);
    });

    it('считает фид stale при отсутствии снимков (last_t null)', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([{ symbol: 'SOLUSDT', exchange: 'binance' }])
        .mockResolvedValueOnce([{ last_t: null }]);

      const out = await getFeedFreshness();
      expect(out[0].lastT).toBeNull();
      expect(out[0].stale).toBe(true);
      expect(out[0].lagMs).toBe(Infinity);
    });
  });

  describe('recordAudit', () => {
    it('пишет запись аудита', async () => {
      mockAuditCreate.mockResolvedValueOnce({});
      const actor = { userId: 'u1', email: 'boss@example.com' } as any;
      await recordAudit(actor, 'login', { targetType: 'user', targetId: 'u2' });
      expect(mockAuditCreate).toHaveBeenCalledTimes(1);
      const data = mockAuditCreate.mock.calls[0][0].data;
      expect(data.actorId).toBe('u1');
      expect(data.actorEmail).toBe('boss@example.com');
      expect(data.action).toBe('login');
      expect(data.targetType).toBe('user');
    });

    it('не валится при ошибке записи (логирует и молча продолжает)', async () => {
      mockAuditCreate.mockRejectedValueOnce(new Error('db down'));
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const actor = { userId: 'u1', email: 'boss@example.com' } as any;
      await expect(recordAudit(actor, 'login')).resolves.toBeUndefined();
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });
});
