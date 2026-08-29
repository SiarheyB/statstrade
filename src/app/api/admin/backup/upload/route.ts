import { NextResponse } from 'next/server';
import { join } from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { getAdminSession, notFound, recordAudit } from '@/lib/admin';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();
const TMP_DIR = join(PROJECT_ROOT, 'backup', 'tmp');

// Дамп базы бывает большим, но не бесконечным: без потолка любой запрос писал
// на диск сервера столько, сколько влезет в тело.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

/** Расширения, которые умеет принять скрипт восстановления. */
const ALLOWED_EXT = ['.sql', '.jsonl'] as const;

/**
 * Имя файла, безопасное для join(TMP_DIR, …): ни "/", ни "..", ни ведущих
 * точек. Расширение сохраняем отдельно — иначе имя вида ".sql" схлопывалось в
 * "_sql", и загруженный файл потом не проходил проверку в роуте восстановления.
 */
function safeFileName(original: string, ext: string): string {
  const stem = original
    .slice(0, original.length - ext.length)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^[._-]+/, '_')
    .slice(0, 180);
  return `${stem || 'backup'}${ext}`;
}

export async function POST(request: Request) {
  // Раньше проверки не было вовсе: /api/admin/* не подпадает под гард
  // middleware (он смотрит на префикс /admin), и роут был открыт анонимно.
  const session = await getAdminSession();
  if (!session) return notFound();

  // Отказ ДО чтения тела: раньше и formData(), и arrayBuffer() поднимали файл
  // в память целиком (то есть до ~400 МБ на одну загрузку при потолке в 200),
  // и только после этого сверялся размер. nginx для этого пути пропускает до
  // 256 МБ и не буферизует, так что тело доезжало до Node полностью.
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File is too large' }, { status: 413 });
  }

  let targetPath: string | null = null;
  try {
    await fs.mkdir(TMP_DIR, { recursive: true });
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }
    const ext = ALLOWED_EXT.find((e) => file.name.endsWith(e));
    if (!ext) {
      return NextResponse.json({ error: 'Only .sql or .jsonl files allowed' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'File is too large' }, { status: 413 });
    }

    const safeName = safeFileName(file.name, ext);
    targetPath = join(TMP_DIR, safeName);

    // Пишем потоком, а не Buffer.from(await file.arrayBuffer()): вторая полная
    // копия файла в памяти не нужна.
    //
    // Счётчик — ЗВЕНОМ конвейера, а не слушателем 'data' на источнике: такой
    // слушатель сразу переводит поток в flowing-режим, и pipeline получает его
    // уже частично вычитанным. Здесь же байты считаются ровно там, где они
    // проходят дальше. Проверка дублирует Content-Length выше на случай, если
    // он соврал или его не было вовсе.
    let written = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        written += chunk.length;
        if (written > MAX_UPLOAD_BYTES) return done(new Error('too large'));
        done(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]),
      counter,
      createWriteStream(targetPath),
    );

    await recordAudit(session, 'backup.upload', {
      targetType: 'backup',
      targetLabel: safeName,
      detail: `${written} bytes`,
    });
    return NextResponse.json({ success: true, name: safeName, size: written });
  } catch (err) {
    // Оборванная или слишком большая загрузка не должна оставлять огрызок:
    // он попал бы в список файлов админки и выглядел бы годным для импорта.
    if (targetPath) await fs.unlink(targetPath).catch(() => {});
    const message = (err as Error).message;
    if (message === 'too large') {
      return NextResponse.json({ error: 'File is too large' }, { status: 413 });
    }
    return NextResponse.json({ error: `Upload failed: ${message}` }, { status: 500 });
  }
}
