import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, isAdminEmail, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";
import { deleteUserCascade } from "@/lib/deleteUser";

export const dynamic = "force-dynamic";

// Действия над пользователем. Сейчас: сброс 2FA (на случай потери доступа).
export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let body: { id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const { id, action } = body;
  if (!id || !action) return badRequest("Нужны id и action");

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!target) return badRequest("Пользователь не найден");

  try {
    if (action === "reset2fa") {
      await prisma.user.update({
        where: { id },
        data: { twoFactorEnabled: false, twoFactorSecret: null },
      });
      await recordAudit(session, "user.reset2fa", { targetType: "user", targetId: id, targetLabel: target.email });
      return NextResponse.json({ ok: true });
    }
    return badRequest("Неизвестное действие");
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Удаление пользователя (cascade: аккаунты, fills, аннотации и т.д. — см. схему).
// Нельзя удалить самого себя и нельзя удалить другого администратора.
export async function DELETE(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("Не указан id");

  try {
    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!target) return badRequest("Пользователь не найден");
    if (target.id === session.userId) return badRequest("Нельзя удалить свой аккаунт");
    if (isAdminEmail(target.email)) return badRequest("Нельзя удалить администратора");

    await deleteUserCascade(id);
    await recordAudit(session, "user.delete", { targetType: "user", targetId: id, targetLabel: target.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
