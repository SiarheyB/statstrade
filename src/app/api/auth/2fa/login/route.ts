import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createSessionCookie,
  getPendingUserId,
  clearPendingCookie,
} from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { verifyTotp } from "@/lib/totp";
import { badRequest, serverError } from "@/lib/api";
import { kickUserSync } from "@/lib/sync";

const schema = z.object({ code: z.string().min(6).max(7) });

// Second step of login: verify the TOTP code for the user whose password was
// already accepted (proven by the short-lived pending cookie), then issue the
// real session.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Введите код из приложения");

  try {
    const userId = await getPendingUserId();
    if (!userId) return badRequest("Сессия подтверждения истекла, войдите снова");

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      await clearPendingCookie();
      return badRequest("Двухфакторная аутентификация не настроена");
    }

    const secret = decrypt(user.twoFactorSecret);
    if (!verifyTotp(parsed.data.code, secret)) {
      return badRequest("Неверный код");
    }

    await clearPendingCookie();
    await createSessionCookie({ userId: user.id, email: user.email });
    kickUserSync(user.id); // freshen accounts on return, fire-and-forget
    return NextResponse.json({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
