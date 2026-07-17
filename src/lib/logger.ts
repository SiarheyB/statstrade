import { LogService, LogLevel } from "./log.service";

/**
 * Logger helper for use across the application.
 *
 * Usage:
 * ```ts
 * import { logger } from "@/lib/logger";
 *
 * logger.info("import", accountId, "File received", { size: 12345 });
 * logger.error("collector", null, "Failed to connect", { error: e.message, stack: e.stack });
 * ```
 */
export const logger = {
  /**
   * Log an info level message
   */
  info: (
    module: string,
    accountId: string | null,
    message: string,
    details: Record<string, any> = {}
  ) => LogService.record(module, accountId, message, details, "info"),

  /**
   * Log a warning level message
   */
  warn: (
    module: string,
    accountId: string | null,
    message: string,
    details: Record<string, any> = {}
  ) => LogService.record(module, accountId, message, details, "warn"),

  /**
   * Log an error level message
   */
  error: (
    module: string,
    accountId: string | null,
    message: string,
    details: Record<string, any> = {},
    error?: Error
  ) => {
    if (error) {
      details = {
        ...details,
        error: error.message,
        stack: error.stack,
      };
    }
    LogService.record(module, accountId, message, details, "error");
  },
};

/**
 * Convenience function to create a scoped logger for a specific module and account
 * Useful when you have many logs for the same module/account combo
 */
export function createScopedLogger(module: string, accountId: string | null) {
  return {
    info: (message: string, details?: Record<string, any>) =>
      logger.info(module, accountId, message, details),
    warn: (message: string, details?: Record<string, any>) =>
      logger.warn(module, accountId, message, details),
    error: (message: string, details?: Record<string, any>, error?: Error) =>
      logger.error(module, accountId, message, details, error),
  };
}