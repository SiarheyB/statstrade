import { prisma } from "./db";

export type LogLevel = "info" | "warn" | "error";
export type EventType = string;

export class LogService {
  static async record(
    module: string,
    accountId: string | null,
    eventType: EventType,
    message: string,
    details: Record<string, any> = {},
    level: LogLevel = "info",
  ): Promise<void> {
    // Check if logging is enabled via environment variable
    if (process.env.ENABLE_IMPORT_LOGS !== "true") {
      return;
    }

    try {
      await prisma.importLog.create({
        data: {
          module,
          accountId,
          eventType,
          message,
          details: details as any,
          level,
        },
      });
    } catch (error) {
      // Never let logging errors break the main flow
      console.error("Failed to write log to database:", error);
    }
  }

  static async fetchPage(
    page: number = 1,
    limit: number = 20,
    filters: {
      module?: string;
      accountId?: string;
      eventType?: string;
      startDate?: Date;
      endDate?: Date;
      search?: string;
      level?: LogLevel;
    } = {},
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (filters.module) where.module = filters.module;
    if (filters.accountId) where.accountId = filters.accountId;
    if (filters.eventType) where.eventType = filters.eventType;
    if (filters.level) where.level = filters.level;
    if (filters.search) {
      // Простой поиск по строке message (без учета регистра)
      where.message = { contains: filters.search, mode: "insensitive" };
    }
    if (filters.startDate) where.timestamp = { gte: filters.startDate };
    if (filters.endDate) where.timestamp = { lte: filters.endDate };

    const [logs, total] = await Promise.all([
      prisma.importLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        skip,
        take: limit,
      }),
      prisma.importLog.count({ where }),
    ]);

    return {
      data: logs,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  static async deleteMany(ids: string[]): Promise<void> {
    if (!ids.length) return;

    await prisma.importLog.deleteMany({
      where: {
        id: { in: ids },
      },
    });
  }

  static async cleanupOlderThan(days: number): Promise<{ count: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await prisma.importLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    return { count: result.count };
  }
}