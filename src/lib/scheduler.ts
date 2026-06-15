// In-process scheduler for local / self-hosted deployments. Periodically runs
// due auto-syncs. On serverless, disable via ENABLE_SCHEDULER=false and trigger
// /api/cron/sync with an external cron instead.

let started = false;
const TICK_MS = 60_000; // check every minute; per-account interval gates work

export function startScheduler(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      const { runDueSyncs } = await import("./sync");
      const res = await runDueSyncs();
      if (res.synced.length || res.failed.length) {
        console.log(
          `[scheduler] synced=${res.synced.length} failed=${res.failed.length} due=${res.due}`,
        );
      }
    } catch (err) {
      console.error("[scheduler] tick error:", (err as Error).message);
    }
  };

  // Defer the first tick a bit so it doesn't run during server warm-up.
  setTimeout(tick, 10_000);
  setInterval(tick, TICK_MS);
  console.log("[scheduler] started");
}
