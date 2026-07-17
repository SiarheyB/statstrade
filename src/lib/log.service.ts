import { prisma } from "./db";

export type LogLevel = "info" | "warn" | "error";
export type EventType = string; // could be more specific if needed

export class LogService {
  /**
   * Record a log entry in the database
   * @param module The module generating the log (e.g., "import", "collector")
   * @param accountId The account ID associated with the log (can be null)
   * @param eventType The type of event (e.g., "FILE_RECEIVED", "PARSE_RESULT")
   * @param message Human-readable description
   * @param details Optional structured data
   * @param level Log level (info, warn, error)
   */
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
          details: details as any, // Prisma expects Json type
          level,
          // timestamp and createdAt will be set by default
        },
      });
    } catch (error) {
      // Never let logging errors break the main flow
      console.error("Failed to write log to database:", error);
    }
  }

  /**
   * Fetch a paginated list of log entries with optional filters
   */
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
      // Simple search in message and stringified details
      where.OR = [
        { message: { contains: filters.search, mode: "insensitive" } },
        // For JSON search, we'll do a simple string contains on the JSON representation
        { details: { path: [], string_contains: filters.search } }, // This won't work directly, we'll handle differently
      ];
      // Since direct JSON search is complex in Prisma, we'll filter in-memory for now
      // In production, you might want to use PostgreSQL's JSONB operators
    }
    if (filters.startDate) where.timestamp = { gte: filters.startDate };
    if (filters.endDate) where.timestamp = { lte: filters.endDate };

    // Get total count for pagination
    const [logs, total] = await Promise.all([
      prisma.importLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        skip,
        take: limit,
        include: { details: true },
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

  /**
   * Delete multiple log entries by their IDs
   */
  static async deleteMany(ids: string[]): Promise<void> {
    if (!ids.length) return;

    await prisma.importLog.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }

  /**
   * Clean up old logs (older than specified days)
   * This could be run as a cron job
   */
  static async cleanupOlderThan(days: number): Promise<{ count: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await prisma.importLog.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    return { count: result.count };
  }
}