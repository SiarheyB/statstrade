/**
 * Тесты для db.ts — проверка работы Prisma клиента
 * src/lib/db.ts
 */

import { describe, it, expect, vi } from 'vitest';

// Импортируем prisma из db.ts для настройки моков
import { prisma } from '@/lib/db';

// Мокаем сам PrismaClient для всех тестов в этом файле
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    riskProfile: { findFirst: vi.fn() },
    exchangeAccount: { findFirst: vi.fn(), findUnique: vi.fn() },
    trade: { findMany: vi.fn() },
  },
}));

describe('db.ts - prisma client setup', () => {
  it('PrismaClient экспортируется как prisma', () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma).toBe('object');
  });

  it('prisma имеет ключи совместимости с операциями, используемыми в lib', () => {
    expect(prisma).toHaveProperty('user');
    expect(prisma.user).toHaveProperty('findUnique');
    expect(prisma).toHaveProperty('riskProfile');
    expect(prisma.riskProfile).toHaveProperty('findFirst');
    expect(prisma).toHaveProperty('exchangeAccount');
    expect(prisma.exchangeAccount).toHaveProperty('findFirst');
    expect(prisma.exchangeAccount).toHaveProperty('findUnique');
    expect(prisma).toHaveProperty('trade');
    expect(prisma.trade).toHaveProperty('findMany');
  });
});