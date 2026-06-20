import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { decrypt } from "@/lib/crypto";
import { verifyTotp } from "@/lib/totp";

const schema = z.object({ code: z.string().min(6).max(7) });

// Finish enabling 2FA: verify the first code against the pending secret, then
// flip the account to two-factor-protected.
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Введите код из приложения");

  try {
    const row = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { twoFactorSecret: true },
    });
    if (!row?.twoFactorSecret) {
      return badRequest("Сначала начните настройку (нет ключа)");
    }
    if (!verifyTotp(parsed.data.code, decrypt(row.twoFactorSecret))) {
      return badRequest("Неверный код, попробуйте ещё раз");
    }
    await prisma.user.update({
      where: { id: user.userId },
      data: { twoFactorEnabled: true },
    });
    return NextResponse.json({ enabled: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
