import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound } from "@/lib/admin";
import { serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

// Лёгкий счётчик непрочитанных сообщений поддержки — для колокольчика в меню.
export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    // Только сообщения ОТ юзеров — иначе исходящие ответы админа (тоже readAt
    // null до прочтения юзером) раздували бы этот же счётчик.
    const count = await prisma.supportMessage.count({ where: { authorRole: "user", readAt: null } });
    return NextResponse.json({ count });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
