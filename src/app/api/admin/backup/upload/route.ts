import { NextResponse } from 'next/server';
import { join } from 'path';
import fs from 'fs/promises';

const PROJECT_ROOT = process.cwd();
const TMP_DIR = join(PROJECT_ROOT, 'backup', 'tmp');

export async function POST(request: Request) {
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
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const targetPath = join(TMP_DIR, safeName);
    await fs.writeFile(targetPath, buffer);
    return NextResponse.json({ success: true, name: safeName, size: buffer.length });
  } catch (err: any) {
    return NextResponse.json({ error: `Upload failed: ${err.message}` }, { status: 500 });
  }
}