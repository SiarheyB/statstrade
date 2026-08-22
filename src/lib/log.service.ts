import { Prisma } from "@prisma/client";
import { prisma } from "./db";

export type LogLevel = "info" | "warn" | "error";
export type EventType = string;
/** Произвольная полезная нагрузка лога — уезжает в JSON-колонку как есть. */
export type LogDetails = Record<string, unknown>;

/** Отбор для списка логов: и в API, и в админке одна форма. */
export type LogFilters = {
  module?: string;
  accountId?: string;
  eventType?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  level?: LogLevel;
};

export class LogService {
  static async record(
    module: string,
    accountId: string | null,
    eventType: EventType,
    message: string,
    details: LogDetails = {},
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
          details: details as Prisma.InputJsonObject,
          level,
        },
      });
    } catch (error) {
      // Never let logging errors break the main flow
      console.error("Failed to write log to database:", error);
    }
  }

  static async fetchPage(page: number = 1, limit: number = 20, filters: LogFilters = {}) {
    const skip = (page - 1) * limit;
    const where: Prisma.ImportLogWhereInput = {};

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

  static async deleteAll(): Promise<{ count: number }> {
    const result = await prisma.importLog.deleteMany({});
    return { count: result.count };
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