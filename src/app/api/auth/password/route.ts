import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/auth";

const schema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(8, "Пароль минимум 8 символов").max(200),
});

// Status: does this account have a password? (Google-only accounts don't, so the
// UI offers "set password" without asking for the current one.)
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { password: true },
  });
  return NextResponse.json({ hasPassword: !!row?.password });
}

// Change (or set) the account password.
export async function PUT(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Проверьте данные", parsed.error.flatten().fieldErrors);
  }

  try {
    const row = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { password: true },
    });
    if (!row) return badRequest("Пользователь не найден");

    // If a password already exists, the current one must be provided and correct.
    if (row.password) {
      const current = parsed.data.currentPassword ?? "";
      if (!current || !(await verifyPassword(current, row.password))) {
        return badRequest("Неверный текущий пароль");
      }
    }

    await prisma.user.update({
      where: { id: user.userId },
      data: { password: await hashPassword(parsed.data.newPassword) },
    });
    return NextResponse.json({ hasPassword: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
