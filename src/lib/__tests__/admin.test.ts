import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// getSession дергает next/headers cookies() — мокаем, чтобы getAdminSession
// не падал вне request scope.
const mockGetSession = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    getSession: () => mockGetSession(),
  };
});

vi.mock('@/lib/db', () => ({
  prisma: {},
}));

import {
  isAdminEmail,
  isAdminSession,
  getAdminSession,
  notFound,
  ONLINE_THRESHOLD_MS,
  FEED_STALE_MS,
} from '@/lib/admin';

describe('admin', () => {
  const OLD_ENV = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'boss@example.com, Admin@Example.com';
    mockGetSession.mockReset();
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
});
