import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { verifyPassword, clearSessionCookie } from "@/lib/auth";
import { deleteUserCascade } from "@/lib/deleteUser";

// Пользователь удаляет свой аккаунт. Требуем пароль (если он задан) —
// подтверждение необратимого действия; Google-only аккаунты подтверждают без него.
export async function DELETE(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: { password?: string } = {};
  try {
    body = await req.json();
  } catch {
    // тело необязательно для Google-only аккаунтов
  }

  try {
    const row = await prisma.user.findUnique({ where: { id: user.userId }, select: { password: true } });
    if (!row) return badRequest("Пользователь не найден");

    if (row.password) {
      const password = body.password ?? "";
      if (!password || !(await verifyPassword(password, row.password))) {
        return badRequest("Неверный пароль");
      }
    }

    await deleteUserCascade(user.userId);
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
