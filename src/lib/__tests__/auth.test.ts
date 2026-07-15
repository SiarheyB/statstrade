import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- vi.hoisted для bcrypt ---
const { hash, compare } = vi.hoisted(() => ({
  hash: vi.fn(async (pw: string) => `hashed:${pw}`),
  compare: vi.fn(),
}));
vi.mock('bcrypt', () => ({
  default: { hash, compare },
}));

// --- Мок prisma (для handleLogin) ---
const findUnique = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: { user: { findUnique: (...a: any[]) => findUnique(...a) } },
}));

// --- Мок next/headers cookies (request scope) ---
const cookieStore = new Map<string, { value: string }>();
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => cookieStore.get(n),
    set: (n: string, v: string) => { cookieStore.set(n, { value: v }); },
    delete: (n: string) => { cookieStore.delete(n); },
  }),
}));

// --- Мок jose: SignJWT + jwtVerify через фейковую реализацию ---
// Это устраняет проблему "payload must be an instance of Uint8Array"
// (реальный jose требует криптографического секрета в Uint8Array), а нам
// нужно только поведение round-trip для юнит-тестов.
vi.mock('jose', () => {
  class FakeSignJWT {
    private payload: any;
    constructor(payload: any) { this.payload = payload; }
    setProtectedHeader() { return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    async sign() {
      // Кодируем payload в base64url, чтобы verify мог его раскодировать
      return `fake.${Buffer.from(JSON.stringify(this.payload)).toString('base64url')}.sig`;
    }
  }
  async function fakeJwtVerify(token: string) {
    const parts = token.split('.');
    if (parts[0] !== 'fake') throw new Error('invalid');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return { payload };
  }
  return { SignJWT: FakeSignJWT, jwtVerify: fakeJwtVerify };
});

process.env.JWT_SECRET = 'test-secret';

import {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  generateToken,
  verifyToken,
  handleLogin,
  handleLogout,
  COOKIE_NAME,
} from '@/lib/auth';

describe('auth', () => {
  beforeEach(() => {
    cookieStore.clear();
    findUnique.mockReset();
    compare.mockReset();
    hash.mockReset();
    hash.mockImplementation(async (pw: string) => `hashed:${pw}`);
  });

  describe('hashPassword / verifyPassword', () => {
    it('hashPassword + verifyPassword: совпадающий пароль → true', async () => {
      const hashed = await hashPassword('password123');
      expect(hashed).toMatch(/^hashed:/);
      compare.mockResolvedValue(true);
      expect(await verifyPassword('password123', hashed)).toBe(true);
    });
    it('verifyPassword: несовпадающий пароль → false', async () => {
      const hashed = await hashPassword('secret');
      compare.mockResolvedValue(false);
      expect(await verifyPassword('wrong', hashed)).toBe(false);
    });
  });

  describe('signSession / verifySession (round-trip)', () => {
    it('подписанный токен проверяется обратно', async () => {
      const token = await signSession({ userId: 'u1', email: 'a@b.com' });
      expect(token.split('.')).toHaveLength(3);
      const payload = await verifySession(token);
      expect(payload).toEqual({ userId: 'u1', email: 'a@b.com' });
    });
    it('verifySession возвращает null для битого токена', async () => {
      expect(await verifySession('not.a.jwt')).toBeNull();
    });
  });

  describe('generateToken / verifyToken (proxies)', () => {
    it('round-trip возвращает userId', async () => {
      const token = await generateToken('tester');
      expect(await verifyToken(token)).toBe('tester');
    });
    it('verifyToken возвращает null для невалидного токена', async () => {
      expect(await verifyToken('bad.token')).toBeNull();
    });
  });

  describe('handleLogin', () => {
    it('успех: ставит сессионную куку', async () => {
      findUnique.mockResolvedValue({ id: 'u1', email: 'user@x.com', passwordHash: 'h', tokenVersion: 0 });
      compare.mockResolvedValue(true);
      const result = await handleLogin({ username: 'user@x.com', password: 'pw' });
      expect(result).toEqual({ isSuccess: true });
      expect(cookieStore.has(COOKIE_NAME)).toBe(true);
    });
    it('провал: пользователь не найден', async () => {
      findUnique.mockResolvedValue(null);
      const result = await handleLogin({ username: 'ghost', password: 'pw' });
      expect(result).toEqual({ isSuccess: false });
    });
    it('провал: неверный пароль', async () => {
      findUnique.mockResolvedValue({ id: 'u1', email: 'user@x.com', passwordHash: 'h', tokenVersion: 0 });
      compare.mockResolvedValue(false);
      const result = await handleLogin({ username: 'user@x.com', password: 'bad' });
      expect(result).toEqual({ isSuccess: false });
    });
  });

  describe('handleLogout', () => {
    it('удаляет сессионную куку', async () => {
      findUnique.mockResolvedValue({ id: 'u1', email: 'user@x.com', passwordHash: 'h', tokenVersion: 0 });
      compare.mockResolvedValue(true);
      await handleLogin({ username: 'user@x.com', password: 'pw' });
      expect(cookieStore.has(COOKIE_NAME)).toBe(true);
      await handleLogout();
      expect(cookieStore.has(COOKIE_NAME)).toBe(false);
    });
  });
});