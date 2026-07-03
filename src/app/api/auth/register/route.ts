import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, createSessionCookie } from "@/lib/auth";
import { badRequest, serverError, tooManyRequests } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";

const schema = z.object({
  email: z.string().email("Некорректный email").max(254),
  password: z.string().min(8, "Пароль минимум 8 символов").max(200),
  name: z.string().max(80).optional(),
  turnstileToken: z.string().max(4000).optional(),
  // Honeypot: скрытое поле, которое заполняют только боты. Люди его не видят.
  website: z.string().max(0).optional(),
});

export async function POST(req: Request) {
  // Rate-limit: не более 5 регистраций с одного IP за 15 минут.
  const ip = clientIp(req);
  const rl = rateLimit(`register:${ip}`, 5, 15 * 60_000);
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
  const { email, password, name, website, turnstileToken } = parsed.data;

  // Honeypot заполнен → бот. Общая ошибка, не раскрываем механизм.
  if (website) return badRequest("Проверьте данные");

  // Капча (если настроена TURNSTILE_SECRET; иначе пропускает).
  if (!(await verifyTurnstile(turnstileToken, ip))) {
    return badRequest("Проверка не пройдена, обновите страницу и попробуйте снова");
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return badRequest("Пользователь с таким email уже существует");

    const user = await prisma.user.create({
      data: { email, password: await hashPassword(password), name: name ?? null },
    });

    await createSessionCookie({ userId: user.id, email: user.email }, user.tokenVersion);
    return NextResponse.json({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
