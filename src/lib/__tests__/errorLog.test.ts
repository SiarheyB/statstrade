import { describe, it, expect, vi, beforeEach } from 'vitest';

// Поднимаем мок до всех импортов так, что vi.mock может сослаться на него до инициализации модуля
const shared = vi.hoisted(() => ({
  prisma: {
    errorLog: {
      create: vi.fn().mockResolvedValue(undefined), // default resolved promise
    },
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: shared.prisma,
}));

import { logError } from '@/lib/errorLog';

describe('errorLog - logError', () => {
  beforeEach(() => {
    vi.clearAllMocks(); // reset mock implementation and call counts
    shared.prisma.errorLog.create.mockResolvedValue(undefined);
  });

  it('writes error log to database when called', () => {
    logError('Test error', { path: '/api/test', stack: 'stack trace' });
    expect(shared.prisma.errorLog.create).toHaveBeenCalledWith({
      data: {
        message: 'Test error',
        path: '/api/test',
        stack: 'stack trace',
      },
    });
  });

  it('handles missing path and stack', () => {
    logError('Simple error');
    expect(shared.prisma.errorLog.create).toHaveBeenCalledWith({
      data: {
        message: 'Simple error',
        path: null,
        stack: null,
      },
    });
  });

  it('truncates long message', () => {
    const longMessage = 'x'.repeat(5000);
    logError(longMessage);
    expect(shared.prisma.errorLog.create).toHaveBeenCalled();
  });

  it('truncates long path', () => {
    logError('Error', { path: '/api/' + 'x'.repeat(600) });
    expect(shared.prisma.errorLog.create).toHaveBeenCalled();
  });

  it('truncates long stack', () => {
    const longStack = 'x'.repeat(9000);
    logError('Error', { stack: longStack });
    expect(shared.prisma.errorLog.create).toHaveBeenCalled();
  });

  it('handles database error gracefully', async () => {
    // Make the mock reject once for this test
    shared.prisma.errorLog.create.mockRejectedValueOnce(new Error('DB error'));
    expect(() => logError('Test')).not.toThrow();
  });
});