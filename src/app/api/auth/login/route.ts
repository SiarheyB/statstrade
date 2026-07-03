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

// Фиктивный hash для выравнивания времени ответа: bcrypt.compare выполняется и
// для несуществующего email, иначе быстрый ответ выдаёт, что аккаунта нет.
const DUMMY_HASH = "$2b$10$C6UzMDM.H6dfI/f/IKcEeO7ZLpFvbrAhIcNRLougKUX1nOTNW/PC2";

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

  // Второй ключ лимита — по email: распределённый брутфорс одного аккаунта с
  // многих IP всё равно упирается в 20 попыток в час.
  const rlEmail = rateLimit(`login:email:${email.toLowerCase()}`, 20, 60 * 60_000);
  if (!rlEmail.ok) return tooManyRequests(rlEmail.retryAfterSec);

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    const ok = await verifyPassword(password, user?.password ?? DUMMY_HASH);
    if (!user || !user.password || !ok) {
      return badRequest("Неверный email или пароль");
    }

    // 2FA enabled: defer the session until the TOTP code is verified.
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      await createPendingCookie(user.id);
      return NextResponse.json({ twoFactorRequired: true });
    }

    await createSessionCookie({ userId: user.id, email: user.email }, user.tokenVersion);
    kickUserSync(user.id); // freshen accounts on return, fire-and-forget
    return NextResponse.json({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
