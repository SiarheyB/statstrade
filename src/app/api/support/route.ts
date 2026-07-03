import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Своя переписка с поддержкой: один тред на пользователя (userId = ключ треда).
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const messages = await prisma.supportMessage.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "asc" },
    });
    // Открыл переписку → ответы админа считаются прочитанными.
    await prisma.supportMessage.updateMany({
      where: { userId: user.userId, authorRole: "admin", readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ messages });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.object({ message: z.string().trim().min(1, "Введите сообщение").max(4000) });

// Отправка сообщения (первое или ответ в существующем треде). Rate-limit
// против спама. Автор — текущий пользователь; email из сессии, не от клиента.
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const rl = rateLimit(`support:${clientIp(req)}`, 10, 60 * 60_000); // 10/час с IP
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Проверьте сообщение", parsed.error.flatten().fieldErrors);

  try {
    const msg = await prisma.supportMessage.create({
      data: { userId: user.userId, authorRole: "user", email: user.email, message: parsed.data.message },
    });
    return NextResponse.json({ message: msg });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
