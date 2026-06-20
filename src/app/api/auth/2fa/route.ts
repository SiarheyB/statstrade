import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { decrypt } from "@/lib/crypto";
import { verifyTotp } from "@/lib/totp";

// Current 2FA status for the settings UI.
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { twoFactorEnabled: true },
  });
  return NextResponse.json({ enabled: !!row?.twoFactorEnabled });
}

const disableSchema = z.object({ code: z.string().min(6).max(7) });

// Disable 2FA — requires a valid current code to prevent a hijacked session from
// silently turning it off.
export async function DELETE(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) return badRequest("Введите код из приложения");

  try {
    const row = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { twoFactorEnabled: true, twoFactorSecret: true },
    });
    if (!row?.twoFactorEnabled || !row.twoFactorSecret) {
      return badRequest("Двухфакторная аутентификация не включена");
    }
    if (!verifyTotp(parsed.data.code, decrypt(row.twoFactorSecret))) {
      return badRequest("Неверный код");
    }
    await prisma.user.update({
      where: { id: user.userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    return NextResponse.json({ enabled: false });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
