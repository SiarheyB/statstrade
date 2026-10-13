import { NextResponse } from "next/server";
import { getAuthUser, unauthorized } from "@/lib/api";
import { getAdvisorBuild } from "@/lib/advisorFile";
import { rateLimit } from "@/lib/ratelimit";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { parseUa, primaryLang } from "@/lib/traffic/ua";
import { countryFromHeaders } from "@/lib/traffic/hit";

// Файл советника лежит ВНЕ public/ (актуальная сборка — в БД, загружается из
// /admin/advisor; запасная — downloads/ в образе, см. lib/advisorFile.ts):
// из public его мог бы скачать кто угодно, включая ботов.
// Отдаём только вошедшему зарегистрированному пользователю — демо-сессия
// («посмотреть без регистрации») тоже не считается.

// Журнал скачиваний для админки (/admin/advisor). Сбой записи не должен
// отнимать у человека файл, поэтому всё глотаем.
async function recordDownload(req: Request | undefined, userId: string, email: string, bytes: number, version: string) {
  try {
    const h = req?.headers;
    const ua = parseUa(h?.get("user-agent"));
    let referrer: string | null = null;
    try {
      const ref = h?.get("referer");
      if (ref) referrer = new URL(ref).pathname.slice(0, 200);
    } catch {}
    const before = await prisma.advisorDownload.count({ where: { userId } });
    await prisma.advisorDownload.create({
      data: {
        userId, email, bytes, version, referrer,
        device: ua.device, browser: ua.browser, os: ua.os,
        country: h ? countryFromHeaders(h) : null,
        lang: primaryLang(h?.get("accept-language")),
        isRepeat: before > 0,
      },
    });
  } catch (e) {
    logger.warn("advisor", userId, "download log failed", { err: String(e) });
  }
}

export async function GET(req?: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.demo) {
    return NextResponse.json({ error: "Скачивание доступно после регистрации" }, { status: 403 });
  }
  if (!rateLimit(`advisor-dl:${user.userId}`, 10, 60 * 60_000).ok) {
    return NextResponse.json({ error: "Слишком много скачиваний, попробуйте позже" }, { status: 429 });
  }

  let build: Awaited<ReturnType<typeof getAdvisorBuild>> = null;
  try {
    build = await getAdvisorBuild();
  } catch (e) {
    logger.error("advisor", user.userId, "advisor file read failed", { err: String(e) });
  }
  if (!build) {
    logger.error("advisor", user.userId, "advisor file missing");
    return NextResponse.json({ error: "Файл советника временно недоступен" }, { status: 404 });
  }
  const data = build.data;
  await recordDownload(req, user.userId, user.email, data.length, build.label);
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
