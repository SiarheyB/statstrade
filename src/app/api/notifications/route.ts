import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError, readJsonBody } from "@/lib/api";

// Личные уведомления пользователя для колокольчика в меню: подход цены к
// уровню, скорый выход новости. Объявления администратора приходят отдельно
// (/api/announcements) — они общие для всех, а эти адресные; колокольчик
// показывает и те, и другие одним списком.

// Сколько отдаём за раз. Колокольчик — не архив: показывает свежее, остальное
// всё равно чистится по сроку хранения (см. lib/notifications.ts).
const LIMIT = 30;

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const notifications = await prisma.userNotification.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    });
    return NextResponse.json({ notifications });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

/**
 * Отметить прочитанным: одно уведомление по id либо все сразу (`all: true`).
 */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const body = (await readJsonBody(req)) as { id?: unknown; all?: unknown } | null;
  try {
    // userId в условии обязателен и в ветке по id — иначе чужой id помечал бы
    // чужое уведомление.
    const where =
      body?.all === true
        ? { userId: user.userId, readAt: null }
        : typeof body?.id === "string"
          ? { userId: user.userId, id: body.id }
          : null;
    if (!where) return NextResponse.json({ ok: true, updated: 0 });
    const { count } = await prisma.userNotification.updateMany({
      where,
      data: { readAt: new Date() },
    });
    return NextResponse.json({ ok: true, updated: count });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
