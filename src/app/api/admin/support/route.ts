import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound } from "@/lib/admin";
import { serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

type TicketRow = {
  id: string;
  userId: string;
  subject: string;
  status: string;
  createdAt: Date;
  lastMessageAt: Date;
  lastMessage: string | null;
  lastAuthorRole: string | null;
  email: string | null;
  name: string | null;
  unread: number;
};

// Инбокс тикетов: открытые сверху, внутри группы — по последней активности.
// Последнее сообщение и непрочитанные — коррелированные подзапросы по индексу
// (ticketId, createdAt); тикетов немного, это дёшево.
export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const tickets = await prisma.$queryRaw<TicketRow[]>`
      SELECT t."id", t."userId", t."subject", t."status", t."createdAt", t."lastMessageAt",
        (SELECT sm."message" FROM "SupportMessage" sm
          WHERE sm."ticketId" = t."id" ORDER BY sm."createdAt" DESC LIMIT 1) AS "lastMessage",
        (SELECT sm."authorRole" FROM "SupportMessage" sm
          WHERE sm."ticketId" = t."id" ORDER BY sm."createdAt" DESC LIMIT 1) AS "lastAuthorRole",
        u."email" AS "email",
        u."name" AS "name",
        (SELECT count(*)::int FROM "SupportMessage" sm
          WHERE sm."ticketId" = t."id" AND sm."authorRole" = 'user' AND sm."readAt" IS NULL) AS "unread"
      FROM "SupportTicket" t
      LEFT JOIN "User" u ON u."id" = t."userId"
      ORDER BY (t."status" = 'open') DESC, t."lastMessageAt" DESC
    `;
    const unread = tickets.reduce((s, t) => s + t.unread, 0);
    return NextResponse.json({ tickets, unread });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
