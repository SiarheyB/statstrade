/**
 * Отметки «фоновая задача отработала».
 *
 * Зачем: на самохостинге `ENABLE_SCHEDULER=false` — внутренний планировщик
 * выключен намеренно (иначе задваивалась бы авто-синхронизация бирж), а
 * фоновые задачи дёргает системный крон хоста. Этот крон живёт СНАРУЖИ
 * процесса app, поэтому по env-переменным «работает ли автоматика» узнать
 * нельзя в принципе — только по факту прогонов. Их и пишем сюда.
 */

import { prisma } from "@/lib/db";

export type CronJob = "recommendations.recompute" | "analytics.rollup";
export type CronSource = "scheduler" | "cron";

/**
 * Насколько свежей должна быть отметка, чтобы автоматика считалась живой.
 * Пересчёт рекомендаций — суточный, поэтому 26 часов: сутки плюс запас на
 * задержку крона и на время самого прогона (скан всех пар идёт ~12 минут).
 */
export const HEARTBEAT_STALE_MS = 26 * 3600_000;

export async function recordCronRun(job: CronJob, source: CronSource, at: Date = new Date()) {
  await prisma.cronHeartbeat.upsert({
    where: { job },
    create: { job, lastRunAt: at, source },
    update: { lastRunAt: at, source },
  });
}

export type HeartbeatStatus = {
  lastRunAt: string | null;
  source: CronSource | null;
  /** Прогоны были, но давно — крон отвалился или хост был выключен. */
  stale: boolean;
};

export async function getCronHeartbeat(
  job: CronJob,
  now: Date = new Date(),
): Promise<HeartbeatStatus> {
  const row = await prisma.cronHeartbeat.findUnique({ where: { job } });
  if (!row) return { lastRunAt: null, source: null, stale: false };
  return {
    lastRunAt: row.lastRunAt.toISOString(),
    source: row.source as CronSource,
    stale: now.getTime() - row.lastRunAt.getTime() > HEARTBEAT_STALE_MS,
  };
}
