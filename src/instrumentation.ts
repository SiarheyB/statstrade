// Next.js runs this once when the server process starts. We use it to launch
// the in-process auto-sync scheduler (Node runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.ENABLE_SCHEDULER !== "false") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }

  // Не гейтим на ENABLE_SCHEDULER — на проде он "false" (синк гоняет системный
  // крон хоста), но бэкафилл rr должен отработать при каждом старте контейнера
  // независимо от этого. Fire-and-forget: не блокирует старт сервера, ошибки
  // только логируются. После первого успешного прогона — no-op (сделок с
  // rr=NULL уже не остаётся).
  import("./lib/analytics/rr")
    .then(({ backfillMissingRR }) => backfillMissingRR())
    .then(({ accounts }) => {
      if (accounts > 0) console.log(`[rr-backfill] пересчитан rr для ${accounts} аккаунт(ов)`);
    })
    .catch((err) => console.error("[rr-backfill] ошибка:", err));
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
