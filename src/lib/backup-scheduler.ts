// In-process scheduler for backup operations. Runs periodic backups based on configuration.

let started = false;

export interface BackupSchedule {
  enabled: boolean;
  type: 'daily' | 'hourly' | 'weekly' | 'custom';
  time: string; // HH:mm format for daily/weekly
  cron?: string; // Cron expression for custom schedules
  lastRun?: string;
  updatedAt?: string;
}

export async function startBackupScheduler(): Promise<void> {
  if (started) return;
  started = true;

  try {
    const schedule = await getBackupSchedule();
    if (!schedule.enabled) {
      console.log('[backup-scheduler] Disabled, skipping');
      return;
    }

    // Schedule first run
    await scheduleNextBackup(schedule);
    console.log('[backup-scheduler] Started', { type: schedule.type, time: schedule.time });
  } catch (err) {
    console.error('[backup-scheduler] Start error:', err);
  }
}

export async function getBackupSchedule(): Promise<BackupSchedule> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const PROJECT_ROOT = process.cwd();
  const SCHEDULE_PATH = path.join(PROJECT_ROOT, '.backup-schedule');

  try {
    const data = await fs.readFile(SCHEDULE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    // Default schedule
    return {
      enabled: false,
      type: 'daily',
      time: '02:00',
    };
  }
}

export async function saveBackupSchedule(schedule: Partial<BackupSchedule>): Promise<BackupSchedule> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const PROJECT_ROOT = process.cwd();
  const SCHEDULE_PATH = path.join(PROJECT_ROOT, '.backup-schedule');

  const currentSchedule = await getBackupSchedule();
  const newSchedule: BackupSchedule = {
    ...currentSchedule,
    ...schedule,
    enabled: schedule.enabled ?? currentSchedule.enabled,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(SCHEDULE_PATH, JSON.stringify(newSchedule, null, 2), 'utf8');

  // Restart scheduler with new configuration
  started = false;
  await startBackupScheduler();

  return newSchedule;
}

async function scheduleNextBackup(schedule: BackupSchedule): Promise<void> {
  try {
    switch (schedule.type) {
      case 'daily':
        await scheduleDailyBackup(schedule);
        break;
      case 'hourly':
        await scheduleHourlyBackup(schedule);
        break;
      case 'weekly':
        await scheduleWeeklyBackup(schedule);
        break;
      case 'custom':
        if (schedule.cron) {
          await scheduleCronBackup(schedule.cron);
        }
        break;
    }
  } catch (err) {
    console.error('[backup-scheduler] Schedule error:', err);
  }
}

async function scheduleDailyBackup(schedule: BackupSchedule): Promise<void> {
  const now = new Date();
  const [hours, minutes] = schedule.time.split(':').map(Number);
  const nextRun = new Date();
  nextRun.setHours(hours, minutes, 0, 0);

  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  const delay = nextRun.getTime() - now.getTime();
  setTimeout(() => runBackupAndReschedule(), delay);
}

async function scheduleHourlyBackup(schedule: BackupSchedule): Promise<void> {
  const now = new Date();
  const nextRun = new Date();
  nextRun.setMinutes(0, 0, 0);
  nextRun.setSeconds(0);

  const minutesUntilNextHour = 60 - now.getMinutes();
  nextRun.setMinutes(now.getMinutes() + minutesUntilNextHour);

  const delay = nextRun.getTime() - now.getTime();
  setTimeout(() => runBackupAndReschedule(), delay);
}

async function scheduleWeeklyBackup(schedule: BackupSchedule): Promise<void> {
  const now = new Date();
  const [hours, minutes] = schedule.time.split(':').map(Number);
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

    // Trigger backup operation
    console.log('[backup-scheduler] Running scheduled backup', schedule.type);
    await triggerBackup();

    // Update last run time
    schedule.lastRun = new Date().toISOString();
    await saveBackupSchedule(schedule);

    // Schedule next backup
    await scheduleNextBackup(schedule);
  } catch (err) {
    console.error('[backup-scheduler] Run error:', err);

    // Reschedule after longer delay on failure
    setTimeout(() => runBackupAndReschedule(), 5 * 60 * 1000); // 5 minutes
  }
}

async function triggerBackup(): Promise<void> {
  // Trigger a backup operation
  const http = await import('http');
  const { URL } = await import('url');
  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ action: 'export_full' });
    const url = new URL('/api/admin/backup', BASE_URL);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length.toString(),
      },
    };

    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`Backup failed: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}