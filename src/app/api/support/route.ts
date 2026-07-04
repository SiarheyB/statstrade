import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Список своих обращений (тикетов) + число непрочитанных ответов админа в каждом.
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const [tickets, unreadRows] = await Promise.all([
      prisma.supportTicket.findMany({
        where: { userId: user.userId },
        orderBy: { lastMessageAt: "desc" },
      }),
      prisma.supportMessage.groupBy({
        by: ["ticketId"],
        where: { userId: user.userId, authorRole: "admin", readAt: null },
        _count: { _all: true },
      }),
    ]);
    const unreadMap = new Map(unreadRows.map((r) => [r.ticketId, r._count._all]));
    return NextResponse.json({
      tickets: tickets.map((t) => ({ ...t, unread: unreadMap.get(t.id) ?? 0 })),
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.object({ message: z.string().trim().min(1, "Введите сообщение").max(4000) });

// Тема тикета: первая строка первого сообщения, обрезанная до 80 символов.
function subjectFrom(message: string): string {
  const line = message.split("\n")[0].trim();
  return line.length > 80 ? line.slice(0, 79) + "…" : line;
}

// Новое обращение: создаёт тикет с первым сообщением. Ответы в существующий
// тикет идут через POST /api/support/[ticketId].
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
    const ticket = await prisma.supportTicket.create({
      data: {
        userId: user.userId,
        subject: subjectFrom(parsed.data.message),
        messages: {
          create: {
            userId: user.userId,
            authorRole: "user",
            email: user.email,
            message: parsed.data.message,
          },
        },
      },
    });
    return NextResponse.json({ ticket });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
