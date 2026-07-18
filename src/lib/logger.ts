import { LogService, LogLevel } from "./log.service";

/**
 * Logger helper for use across the application.
 *
 * Supports two calling conventions:
 * 1. Legacy: logger.info(module, accountId, message, details)
 * 2. New:    logger.info(module, accountId, eventType, message, details)
 *
 * Usage:
 * ```ts
 * import { logger } from "@/lib/logger";
 *
 * // Legacy (used in import route)
 * logger.info("import", accountId, "File received", { size: 12345 });
 *
 * // New style with explicit eventType
 * logger.info("import", accountId, "FILE_RECEIVED", "File received", { size: 12345 });
 * logger.error("collector", null, "CONNECTION_FAILED", "Failed to connect", { error: e.message, stack: e.stack });
 * ```
 */
function normalizeArgs(args: any[]) {
  const [module, accountId, ...rest] = args;

  if (rest.length === 2) {
    // Legacy: [message, details]
    const [message, details] = rest;
    return { module, accountId, eventType: message, message, details };
  } else if (rest.length >= 3) {
    // New: [eventType, message, details?, error?]
    const [eventType, message, details = {}, error] = rest;
    return { module, accountId, eventType, message, details, error };
  }

  // Fallback
  return { module, accountId, eventType: "", message: "", details: {} };
}
function createLogger() {
  return {
    info: (...args: any[]) => {
      const { module, accountId, eventType, message, details } = normalizeArgs(args);
      return LogService.record(module, accountId, eventType, message, details, "info");
    },

    warn: (...args: any[]) => {
      const { module, accountId, eventType, message, details } = normalizeArgs(args);
      return LogService.record(module, accountId, eventType, message, details, "warn");
    },

    error: (...args: any[]) => {
      const { module, accountId, eventType, message, details, error } = normalizeArgs(args);
      const mergedDetails = error
        ? { ...details, error: error.message, stack: error.stack }
        : details;
      return LogService.record(module, accountId, eventType, message, mergedDetails, "error");
    },
  };
}

export const logger = createLogger();

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