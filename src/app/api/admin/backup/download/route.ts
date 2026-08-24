/**
 * Скачивание файла резервной копии.
 *
 * Без него экспорт был дорогой операцией «в никуда»: дамп создавался внутри
 * контейнера app, а забрать его через интерфейс было нельзя — список файлов
 * умел только показать и удалить. Плюс контейнер пересоздаётся на каждом
 * деплое, так что несохранённый дамп жил до ближайшего обновления.
 *
 * Файл отдаётся потоком: дамп базы легко весит сотни мегабайт, читать его
 * целиком в память ради ответа незачем.
 */

import { NextResponse } from "next/server";
import { join } from "path";
import { createReadStream } from "fs";
import { Readable } from "stream";
import fs from "fs/promises";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

const TMP_DIR = join(process.cwd(), "backup", "tmp");

// Тот же контракт, что в основном роуте: только базовое имя, только .sql/.jsonl.
// join(TMP_DIR, name) с такой строкой не может выйти за каталог.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function isSafeBackupName(name: string | null): name is string {
  if (!name || name.length > 200) return false;
  if (!SAFE_NAME.test(name)) return false;
  if (name.includes("..")) return false;
  return name.endsWith(".sql") || name.endsWith(".jsonl");
}

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  const name = new URL(request.url).searchParams.get("file");
  if (!isSafeBackupName(name)) return badRequest("Некорректное имя файла");

  const filePath = join(TMP_DIR, name);
  let size: number;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return badRequest("Некорректное имя файла");
    size = stat.size;
  } catch {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }

  await recordAudit(session, "backup.download", { targetType: "backup", targetLabel: name });

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      // filename без кавычек внутри: имя уже проверено SAFE_NAME.
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
