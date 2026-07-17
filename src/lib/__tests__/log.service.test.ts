import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LogService } from '../../lib/log.service';
import { prisma } from '../../lib/db';

// Mock the entire prisma object for testing
vi.mock('../../lib/db', async () => {
  const actual = await vi.importActual('../../lib/db');
  return {
    ...actual,
    prisma: {
      ...actual.prisma,
      importLog: {
        findMany: vi.fn(),
        count: vi.fn(),
        createMany: vi.fn(),
        deleteMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

describe('LogService', () => {
  const mockLogsResponse = {
    data: [
      {
        id: '1',
        module: 'import',
        accountId: 'acc1',
        eventType: 'FILE_RECEIVED',
        message: 'File received',
        level: 'info',
        timestamp: new Date().toISOString(),
        details: { size: 1024 },
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
    pages: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch paginated logs with filters', async () => {
    // Arrange
    prisma.importLog.findMany.mockResolvedValue(mockLogsResponse.data);
    prisma.importLog.count.mockResolvedValue(mockLogsResponse.total);

    // Act
    const result = await LogService.fetchPage(1, 20, {
      module: 'import',
      search: 'file received',
    });

    // Assert
    expect(result).toEqual(mockLogsResponse);
    expect(prisma.importLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          module: 'import',
          OR: [
            { message: { contains: 'file received', mode: 'insensitive' } },
            {
              details: {
                path: [],
                string_contains: 'file received',
              },
            },
          ],
        }),
        skip: 0,
        take: 20,
        orderBy: { timestamp: 'desc' },
        include: { details: true },
      })
    );
    expect(prisma.importLog.count).toHaveBeenCalledWith({
      where: expect.any(Object),
    });
  });

  it('should return empty array when no logs match filters', async () => {
    // Arrange
    prisma.importLog.findMany.mockResolvedValue([]);
    prisma.importLog.count.mockResolvedValue(0);

    // Act
    const result = await LogService.fetchPage(1, 20, {});

    // Assert
    expect(result).toEqual({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      pages: 0,
    });
  });

  it('should delete logs by IDs', async () => {
    // Arrange
    prisma.importLog.deleteMany.mockResolvedValue({ count: 1 });

    // Act
    await LogService.deleteMany(['1']);

    // Assert
    expect(prisma.importLog.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['1'] } },
    });
  });

  it('should clean up old logs', async () => {
    // Arrange
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    prisma.importLog.deleteMany.mockResolvedValue({ count: 5 });

    // Act
    const result = await LogService.cleanupOlderThan(30);

    // Assert
    expect(result).toEqual({ count: 5 });
    expect(prisma.importLog.deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });
  });

  it('should record a log entry', async () => {
    // Arrange
    process.env.ENABLE_IMPORT_LOGS = 'true';
    prisma.importLog.create.mockResolvedValue({});

    // Act
    await LogService.record('import', 'acc1', 'FILE_RECEIVED', 'Test message', { test: true }, 'info');

    // Assert
    expect(prisma.importLog.create).toHaveBeenCalledWith({
      data: {
        module: 'import',
        accountId: 'acc1',
        eventType: 'FILE_RECEIVED',
        message: 'Test message',
        details: { test: true },
        level: 'info',
      },
    });
  });
});