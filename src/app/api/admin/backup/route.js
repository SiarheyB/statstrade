import { spawn } from 'child_process';
import { join } from 'path';
import fs from 'fs/promises';

const PROJECT_ROOT = process.cwd();
const BACKUP_SCRIPT = join(PROJECT_ROOT, 'backup', 'db-backup-functions.sh');
const TMP_DIR = join(PROJECT_ROOT, 'backup', 'tmp');
const LOG_FILE = join(PROJECT_ROOT, 'backup', 'db-backup-functions.log');

// in-memory store for ops
const operations = {};

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

async function ensureTmpDir() {
  try {
    await fs.access(TMP_DIR);
  } catch {
    await fs.mkdir(TMP_DIR, { recursive: true });
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const operationId = searchParams.get('operationId');

  // Handle file download
  if (action === 'download') {
    const file = searchParams.get('file');
    if (!file) {
      return new Response(JSON.stringify({ error: 'Missing file parameter' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    try {
      await ensureTmpDir();
      const filePath = join(TMP_DIR, file);
      await fs.access(filePath);
      const stat = await fs.stat(filePath);
      const fileStream = (await import('fs')).createReadStream(filePath);
      const { Readable } = await import('stream');
      return new Response(Readable.toWeb(fileStream), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${file}"`,
          'Content-Length': stat.size.toString(),
        },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: `Failed to download file: ${e.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Handle scheduled backup configuration read
  if (action === 'schedule') {
    try {
      const schedulePath = join(PROJECT_ROOT, '.backup-schedule');
      let schedule = null;
      try {
        const data = await fs.readFile(schedulePath, 'utf8');
        schedule = JSON.parse(data);
      } catch (e) {
        // schedule file doesn't exist yet
      }
      return new Response(JSON.stringify({ schedule }), { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: `Failed to read schedule: ${e.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  if (action === 'list') {
    try {
      await ensureTmpDir();
      const files = await fs.readdir(TMP_DIR);
      const fileInfos = await Promise.all(
        files
          .filter(f => f.endsWith('.sql') || f.endsWith('.jsonl'))
          .map(async (f) => {
            const path = join(TMP_DIR, f);
            const stat = await fs.stat(path);
            return { name: f, path, size: stat.size, modified: stat.mtime.getTime() };
          })
      );
      return new Response(JSON.stringify({ files: fileInfos }), { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Failed to list files' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Handle operation status polling for backup operations
  if (operationId && (!action || action === 'status' || action === '')) {
    if (operations[operationId]) {
      const op = operations[operationId];
      return new Response(JSON.stringify({
        logs: op.logs,
        status: op.status,
        startedAt: op.startedAt,
        updatedAt: new Date().toISOString()
      }), { headers: { 'Content-Type': 'application/json' } });
    } else {
      return new Response(JSON.stringify({ error: 'Operation not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
  }

  if (action === 'logs' && operationId) {
    const op = operations[operationId];
    if (!op) {
      return new Response(JSON.stringify({ error: 'Operation not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ logs: op.logs, status: op.status }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Invalid action' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function POST(request) {
  try {
    await ensureTmpDir();
    const body = await request.json();
    const { action, file } = body;
    if (!action) {
      return new Response(JSON.stringify({ error: 'Missing action' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Handle schedule save
    if (action === 'schedule') {
      const { enabled, type, time, cron } = body;
      const schedulePath = join(PROJECT_ROOT, '.backup-schedule');
      const schedule = {
        enabled: Boolean(enabled),
        type: type || 'daily',
        time: time || '02:00',
        cron: cron || '',
        updatedAt: new Date().toISOString(),
      };
      await fs.writeFile(schedulePath, JSON.stringify(schedule, null, 2), 'utf8');
      return new Response(JSON.stringify({ success: true, schedule }), { headers: { 'Content-Type': 'application/json' } });
    }

    const operationId = generateId();
    const op = { id: operationId, status: 'pending', logs: [], startedAt: Date.now() };
    operations[operationId] = op;

    // run in background
    (async () => {
      op.status = 'running';
      op.logs.push(`[${new Date().toISOString()}] Starting ${action}`);
      const args = [action];
      if (file) {
        const safePath = join(TMP_DIR, file);
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
    })();

    return new Response(JSON.stringify({ operationId }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to start operation: ${err.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function DELETE(request) {
  try {
    // Parse request body to get action
    let action = 'delete-file'; // default action
    let filename = null;
    let backupLog = false;

    try {
      const body = await request.json();
      action = body.action || action;
      filename = body.filename || null;
      backupLog = body.action === 'clear-logs';
    } catch {
      // If request body parsing fails, treat as regular request with file param
      const { searchParams } = new URL(request.url);
      filename = searchParams.get('file');
    }

    // NEW: Clear all logs endpoint - deletes the log file itself
    if (backupLog) {
      try {
        await fs.unlink(LOG_FILE);
        // Also clear operations memory
        const currentIds = Object.keys(operations);
        for (const id of currentIds) {
          delete operations[id];
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: `Failed to delete log: ${e.message}` }), {
          status: 500, headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Clear all files endpoint (existing functionality)
    if (action === 'clear-all') {
      await ensureTmpDir();
      // Delete all files in TMP_DIR
      const files = await fs.readdir(TMP_DIR);
      await Promise.all(files.map(f => fs.unlink(join(TMP_DIR, f))));
      // remove all operations references
      const currentIds = Object.keys(operations);
      for (const id of currentIds) {
        delete operations[id];
      }
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Existing delete file logic (existing behavior)
    await ensureTmpDir();
    const { searchParams } = new URL(request.url);
    const fileParam = searchParams.get('file');
    const fileToDelete = filename || fileParam;
    if (!fileToDelete) {
      return new Response(JSON.stringify({ error: 'Missing file parameter' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const filePath = join(TMP_DIR, fileToDelete);
    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
      // remove any operations referencing this file
      for (const [id, op] of Object.entries(operations)) {
        if (op.logs && op.logs.some(l => l.includes(fileToDelete))) {
          delete operations[id];
        }
      }
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: `Failed to delete file: ${e.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: `Delete error: ${err.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}