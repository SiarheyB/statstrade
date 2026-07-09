// Next.js runs this once when the server process starts. We use it to launch
// the in-process auto-sync scheduler (Node runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.ENABLE_SCHEDULER === "false") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();

  // Start backup scheduler
  const { startBackupScheduler } = await import("./lib/backup-scheduler");
  startBackupScheduler();
}

// Global catch for errors NOT already handled by a route's own try/catch (the
// serverError() helper logs those). This covers crashes/exceptions that escape
// a handler entirely, so the admin error log sees everything server-side.
export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { logError } = await import("./lib/errorLog");
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const path = request?.method && request?.path ? `${request.method} ${request.path}` : request?.path;
    logError(message, { path, stack });
  } catch {
    // Logging must never throw or it could mask the original error.
  }
}
