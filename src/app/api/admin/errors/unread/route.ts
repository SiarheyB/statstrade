import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound } from "@/lib/admin";
import { serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

// Лёгкий счётчик новых (непрочитанных) ошибок — для бейджа в меню, без пометки
// прочитанным (это делает только открытие /admin/errors).
export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const count = await prisma.errorLog.count({ where: { readAt: null } });
    return NextResponse.json({ count });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
