import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getAuthUser, unauthorized } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { logger } from "@/lib/logger";

// Файл советника лежит ВНЕ public/ (папка downloads/ в корне, в образ её кладёт
// Dockerfile): из public его мог бы скачать кто угодно, включая ботов.
// Отдаём только вошедшему зарегистрированному пользователю — демо-сессия
// («посмотреть без регистрации») тоже не считается.
const FILE = path.join(process.cwd(), "downloads", "TradeGridPanel.ex5");

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.demo) {
    return NextResponse.json({ error: "Скачивание доступно после регистрации" }, { status: 403 });
  }
  if (!rateLimit(`advisor-dl:${user.userId}`, 10, 60 * 60_000).ok) {
    return NextResponse.json({ error: "Слишком много скачиваний, попробуйте позже" }, { status: 429 });
  }

  let data: Buffer;
  try {
    data = await readFile(FILE);
  } catch {
    logger.error("advisor", user.userId, "advisor file missing", { file: FILE });
    return NextResponse.json({ error: "Файл советника временно недоступен" }, { status: 404 });
  }
  logger.info("advisor", user.userId, "advisor downloaded", { bytes: data.length });
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": 'attachment; filename="TradeGridPanel.ex5"',
      "content-length": String(data.length),
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
