import { NextResponse } from 'next/server';
import { join } from 'path';
import fs from 'fs/promises';
import { getAdminSession, notFound, recordAudit } from '@/lib/admin';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();
const TMP_DIR = join(PROJECT_ROOT, 'backup', 'tmp');

// Дамп базы бывает большим, но не бесконечным: без потолка любой запрос писал
// на диск сервера столько, сколько влезет в тело.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

export async function POST(request: Request) {
  // Раньше проверки не было вовсе: /api/admin/* не подпадает под гард
  // middleware (он смотрит на префикс /admin), и роут был открыт анонимно.
  const session = await getAdminSession();
  if (!session) return notFound();

  try {
    await fs.mkdir(TMP_DIR, { recursive: true });
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }
    // безопасность: только .sql / .jsonl
    if (!file.name.endsWith('.sql') && !file.name.endsWith('.jsonl')) {
      return NextResponse.json({ error: 'Only .sql or .jsonl files allowed' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'File is too large' }, { status: 413 });
    }
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    // Имя приводим к безопасному ДО join: ни "/", ни ".." в него не попадут.
    const safeName = file.name
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '_')
      .replace(/^[._-]+/, '_');
    const targetPath = join(TMP_DIR, safeName);
    await fs.writeFile(targetPath, buffer);
    await recordAudit(session, 'backup.upload', {
      targetType: 'backup',
      targetLabel: safeName,
      detail: `${buffer.length} bytes`,
    });
    return NextResponse.json({ success: true, name: safeName, size: buffer.length });
  } catch (err) {
    return NextResponse.json(
      { error: `Upload failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
