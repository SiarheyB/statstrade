'use strict';

// Shared backup runner - used by both route.ts (HTTP) and backup-scheduler.ts (direct trigger)
// No auth middleware, no HTTP - just spawns the bash script directly

import { spawn } from 'child_process';
import { join } from 'path';

const PROJECT_ROOT = process.cwd();
const BACKUP_SCRIPT = join(PROJECT_ROOT, 'backup', 'db-backup-functions.sh');

export let operations = {} as Record<string, any>;

export async function runBackupScript(action: string, file?: string): Promise<string> {
  const key = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  const opId = key;

  if (!operations[opId]) operations[opId] = { status: 'pending', logs: [], startedAt: Date.now() };

  const op = operations[opId];
  op.status = 'running';
  op.logs.push(`[${new Date().toISOString()}] Starting ${action}`);

  try {
    const args = [action];
    if (file) {
      const safePath = join(PROJECT_ROOT, 'backup', 'tmp', file);
      args.push(safePath);
    }
    const child = spawn('bash', [BACKUP_SCRIPT, ...args], { cwd: PROJECT_ROOT, env: process.env });

    child.stdout.on('data', (data) => {
      const str = data.toString();
      op.logs.push(str.trim());
    });
    child.stderr.on('data', (data) => {
      const str = data.toString();
      op.logs.push(`[ERROR] ${str.trim()}`);
    });
    child.on('close', (code) => {
      op.completedAt = Date.now();
      op.status = code === 0 ? 'success' : 'error';
      op.logs.push(`[${new Date().toISOString()}] Process exited with code ${code}`);
    });
  } catch (e) {
    op.status = 'error';
    op.logs.push(`[${new Date().toISOString()}] Run error: ${(e as Error).message}`);
  }

  return opId;
}