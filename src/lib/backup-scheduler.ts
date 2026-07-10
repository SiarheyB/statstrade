// In-process scheduler for backup operations. Runs periodic backups based on configuration.
// Uses user-selected timezone (from cookie or fallback) to compute UTC timestamps.

import { offsetMinutes } from "./timezone";
import { zonedDateToUtcMs } from "./timezone";
import { runBackupScript } from "./backrunner";

let started = false;
let userTimezone: string | null = null;

export interface BackupSchedule {
  enabled: boolean;
  type: 'daily' | 'hourly' | 'weekly' | 'custom';
  time: string; // HH:mm format for daily/weekly
  cron?: string; // Cron expression for custom schedules
  lastRun?: string;
  updatedAt?: string;
}

export async function setUserTimezone(tz: string): Promise<void> {
  userTimezone = tz;
}

export async function getUserTimezone(): Promise<string> {
  // Fallback to UTC if not set yet
  return userTimezone || "UTC";
}

export async function startBackupScheduler(): Promise<void> {
  if (started) return;
  started = true;

  try {
    const schedule = await getBackupSchedule();
    if (!schedule.enabled) {
      console.log("[backup-scheduler] Disabled, skipping");
      return;
    }

    // Schedule first run
    await scheduleNextBackup(schedule);
    console.log("[backup-scheduler] Started", { type: schedule.type, time: schedule.time });
  } catch (err) {
    console.error("[backup-scheduler] Start error:", err);
  }
}

export async function restartBackupScheduler(): Promise<void> {
  started = false;
  await startBackupScheduler();
}

export async function getBackupSchedule(): Promise<BackupSchedule> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const PROJECT_ROOT = process.cwd();
  const SCHEDULE_PATH = path.join(PROJECT_ROOT, ".backup-schedule");

  try {
    const data = await fs.readFile(SCHEDULE_PATH, "utf8");
    return JSON.parse(data);
  } catch (e) {
    // Default schedule
    return {
      enabled: false,
      type: "daily",
      time: "02:00",
      timezone: "UTC",
    };
  }
}

export async function saveBackupSchedule(schedule: Partial<BackupSchedule>): Promise<BackupSchedule> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const PROJECT_ROOT = process.cwd();
  const SCHEDULE_PATH = path.join(PROJECT_ROOT, ".backup-schedule");

  const currentSchedule = await getBackupSchedule();
  const newSchedule: BackupSchedule = {
    ...currentSchedule,
    ...schedule,
    enabled: schedule.enabled ?? currentSchedule.enabled,
    timezone: schedule.timezone ?? currentSchedule.timezone ?? "UTC",
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(SCHEDULE_PATH, JSON.stringify(newSchedule, null, 2), "utf8");

  // Restart scheduler with new configuration
  started = false;
  await startBackupScheduler();

  return newSchedule;
}

async function scheduleNextBackup(schedule: BackupSchedule): Promise<void> {
  try {
    const now = new Date();
    const [hours, minutes] = schedule.time.split(":").map(Number);

    // Get user timezone for offset calculation
    const tz = await getUserTimezone();
    const offsetMinutesValue = offsetMinutes(tz as any) ?? 0; // 0 for UTC

    // Create a date for today at the specified time in user's timezone
    const today = new Date();
    today.setHours(hours, minutes, 0, 0);

    // Convert to UTC milliseconds for comparison
    const targetTimeUtcMs = zonedDateToUtcMs(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      tz
    );

    let nextRun = new Date(targetTimeUtcMs);

    // If the time has already passed today, schedule for tomorrow
    if (nextRun <= now) {
      nextRun = new Date(nextRun.getTime() + 24 * 60 * 60 * 1000); // add 24 hours
    }

    const delay = nextRun.getTime() - now.getTime();
    setTimeout(() => runBackupAndReschedule(), delay);
  } catch (err) {
    console.error("[backup-scheduler] Schedule error:", err);
  }
}

async function scheduleDailyBackup(schedule: BackupSchedule): Promise<void> {
  await scheduleNextBackup(schedule);
}

async function scheduleHourlyBackup(schedule: BackupSchedule): Promise<void> {
  const now = new Date();
  const nextRun = new Date();
  nextRun.setMinutes(0, 0, 0);
  const minutesUntilNextHour = 60 - now.getMinutes();
  nextRun.setMinutes(now.getMinutes() + minutesUntilNextHour);

  const delay = nextRun.getTime() - now.getTime();
  setTimeout(() => runBackupAndReschedule(), delay);
}

async function scheduleWeeklyBackup(schedule: BackupSchedule): Promise<void> {
  const now = new Date();
  const [hours, minutes] = schedule.time.split(":").map(Number);
  const nextRun = new Date();
  nextRun.setHours(hours, minutes, 0, 0);

  const daysUntilNextSunday = 7 - now.getDay();
  nextRun.setDate(now.getDate() + daysUntilNextSunday);

  const delay = nextRun.getTime() - now.getTime();
  setTimeout(() => runBackupAndReschedule(), delay);
}

async function scheduleCronBackup(cron: string): Promise<void> {
  // For simplicity, just schedule an hourly backup for now
  // In production, you would parse the cron expression properly
  setTimeout(() => runBackupAndReschedule(), 60 * 60 * 1000); // 1 hour
}

async function runBackupAndReschedule(): Promise<void> {
  try {
    const schedule = await getBackupSchedule();
    if (!schedule.enabled) return;

    // Trigger backup operation via shared runner (no HTTP, no auth)
    console.log("[backup-scheduler] Running scheduled backup", schedule.type);
    await runBackupScript("export_full");

    // Update last run time
    schedule.lastRun = new Date().toISOString();
    await saveBackupSchedule(schedule);

    // Schedule next backup
    await scheduleNextBackup(schedule);
  } catch (err) {
    console.error("[backup-scheduler] Run error:", err);

    // Reschedule after longer delay on failure
    setTimeout(() => runBackupAndReschedule(), 5 * 60 * 1000); // 5 minutes
  }
}