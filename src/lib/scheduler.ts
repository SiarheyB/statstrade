// In-process scheduler for local / self-hosted deployments. Periodically runs
// due auto-syncs. On serverless, disable via ENABLE_SCHEDULER=false and trigger
// /api/cron/sync with an external cron instead.

let started = false;
const TICK_MS = 60_000; // check every minute; per-account interval gates work

/**
 * Плановый пересчёт «Рекомендаций» — через 5 минут после закрытия дневной
 * свечи Binance (00:00 UTC), см. lib/recommendations/schedule.ts.
 *
 * «Уже посчитано или нет» определяем по времени последней записи в БД, а не
 * по флагу в памяти: так рестарт контейнера не запускает лишний прогон, а
 * пропущенный из-за простоя слот подхватывается на ближайшем тике.
 */
export async function runDueRecommendationsRecompute(now: Date = new Date()): Promise<boolean> {
  const [{ prisma }, { isRecomputeDue }, { startRecompute }] = await Promise.all([
    import("./db"),
    import("./recommendations/schedule"),
    import("./recommendations/progress"),
  ]);

  const latest = await prisma.levelSetup.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!isRecomputeDue(now, latest?.createdAt ?? null)) return false;

  const { started: didStart } = startRecompute();
  if (didStart) console.log("[scheduler] recommendations: плановый пересчёт запущен");
  return didStart;
}

export function startScheduler(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      const { runDueSyncs } = await import("./sync");
      const res = await runDueSyncs();
      if (res.advanced.length || res.failed.length) {
        console.log(
          `[scheduler] advanced=${res.advanced.length} failed=${res.failed.length} due=${res.due}`,
        );
      }
    } catch (err) {
      console.error("[scheduler] tick error:", (err as Error).message);
    }

    // Отдельный try: падение пересчёта рекомендаций не должно ронять тик
    // авто-синхронизации, и наоборот.
    try {
      await runDueRecommendationsRecompute();
    } catch (err) {
      console.error("[scheduler] recommendations tick error:", (err as Error).message);
    }
  };

  // Defer the first tick a bit so it doesn't run during server warm-up.
  setTimeout(tick, 10_000);
  setInterval(tick, TICK_MS);
  console.log("[scheduler] started");
}
