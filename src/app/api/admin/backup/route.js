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
    await ensureTmpDir();
    const { searchParams } = new URL(request.url);
    const filename = searchParams.get('file');
    if (!filename) {
      return new Response(JSON.stringify({ error: 'Missing file parameter' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const filePath = join(TMP_DIR, filename);
    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
      // remove any operations referencing this file
      for (const [id, op] of Object.entries(operations)) {
        if (op.logs && op.logs.some(l => l.includes(filename))) {
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