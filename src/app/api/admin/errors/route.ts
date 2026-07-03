import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

// Список серверных ошибок + число непрочитанных (для страницы и бейджа).
export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const [errors, unread] = await Promise.all([
      prisma.errorLog.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
      prisma.errorLog.count({ where: { readAt: null } }),
    ]);
    // Открытие журнала отмечает всё прочитанным (снимает бейдж).
    if (unread > 0) {
      await prisma.errorLog.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
    }
    return NextResponse.json({ errors, unread });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Удаление: { id } — одну запись, или { all: true } — все.
const schema = z.object({ id: z.string().optional(), all: z.boolean().optional() });

export async function DELETE(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Проверьте данные");
  const { id, all } = parsed.data;

  try {
    if (all) {
      await prisma.errorLog.deleteMany({});
      await recordAudit(session, "errors.clear_all", { targetType: "ErrorLog" });
    } else if (id) {
      await prisma.errorLog.delete({ where: { id } }).catch(() => {});
      await recordAudit(session, "errors.delete", { targetType: "ErrorLog", targetId: id });
    } else {
      return badRequest("Укажите id или all");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
