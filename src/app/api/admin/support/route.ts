import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound } from "@/lib/admin";
import { serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

type ThreadRow = {
  userId: string;
  lastMessage: string;
  lastAt: Date;
  lastAuthorRole: string;
  email: string | null;
  name: string | null;
};

// Инбокс: один ряд на пользователя — последнее сообщение треда + профиль.
// Непрочитанные (от юзера) считаются отдельным запросом и мёржатся сюда.
export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const [threads, unreadRows] = await Promise.all([
      prisma.$queryRaw<ThreadRow[]>`
        SELECT DISTINCT ON (sm."userId")
          sm."userId" AS "userId",
          sm."message" AS "lastMessage",
          sm."createdAt" AS "lastAt",
          sm."authorRole" AS "lastAuthorRole",
          u."email" AS "email",
          u."name" AS "name"
        FROM "SupportMessage" sm
        LEFT JOIN "User" u ON u.id = sm."userId"
        ORDER BY sm."userId", sm."createdAt" DESC
      `,
      prisma.$queryRaw<{ userId: string; unread: number }[]>`
        SELECT "userId", count(*)::int AS unread
        FROM "SupportMessage"
        WHERE "authorRole" = 'user' AND "readAt" IS NULL
        GROUP BY "userId"
      `,
    ]);
    const unreadMap = new Map(unreadRows.map((r) => [r.userId, r.unread]));
    const items = threads
      .map((t) => ({ ...t, unread: unreadMap.get(t.userId) ?? 0 }))
      .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
    const totalUnread = unreadRows.reduce((s, r) => s + r.unread, 0);
    return NextResponse.json({ threads: items, unread: totalUnread });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
