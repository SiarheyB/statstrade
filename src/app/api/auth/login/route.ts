import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword, createSessionCookie, createPendingCookie } from "@/lib/auth";
import { badRequest, serverError, tooManyRequests } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { kickUserSync } from "@/lib/sync";

const schema = z.object({
  email: z.string().email("Некорректный email").max(254),
  password: z.string().min(1, "Введите пароль").max(200),
});

export async function POST(req: Request) {
  // Rate-limit против брутфорса: 10 попыток входа с одного IP за 10 минут.
  const rl = rateLimit(`login:${clientIp(req)}`, 10, 10 * 60_000);
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

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
  const { email, password } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password || !(await verifyPassword(password, user.password))) {
      return badRequest("Неверный email или пароль");
    }

    // 2FA enabled: defer the session until the TOTP code is verified.
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      await createPendingCookie(user.id);
      return NextResponse.json({ twoFactorRequired: true });
    }

    await createSessionCookie({ userId: user.id, email: user.email });
    kickUserSync(user.id); // freshen accounts on return, fire-and-forget
    return NextResponse.json({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
