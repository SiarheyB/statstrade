import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ticketId: string }> };

// Тикет строго своего пользователя — чужой id даёт null (ответ 400, не 404,
// чтобы не раскрывать существование чужих тикетов перебором).
async function ownTicket(userId: string, ticketId: string) {
  return prisma.supportTicket.findFirst({ where: { id: ticketId, userId } });
}

// Переписка внутри своего тикета. Открытие отмечает ответы админа прочитанными.
export async function GET(_req: Request, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { ticketId } = await params;
  try {
    const ticket = await ownTicket(user.userId, ticketId);
    if (!ticket) return badRequest("Обращение не найдено");
    const messages = await prisma.supportMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: "asc" },
    });
    await prisma.supportMessage.updateMany({
      where: { ticketId, authorRole: "admin", readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ ticket, messages });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.object({ message: z.string().trim().min(1, "Введите сообщение").max(4000) });

// Ответ в свой ОТКРЫТЫЙ тикет. В закрытый писать нельзя — создаётся новое
// обращение (в этом и смысл тикетов).
export async function POST(req: Request, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { ticketId } = await params;

  const rl = rateLimit(`support:${clientIp(req)}`, 10, 60 * 60_000);
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
    const ticket = await ownTicket(user.userId, ticketId);
    if (!ticket) return badRequest("Обращение не найдено");
    if (ticket.status !== "open") return badRequest("Обращение закрыто — создайте новое");

    const [msg] = await prisma.$transaction([
      prisma.supportMessage.create({
        data: {
          ticketId,
          userId: user.userId,
          authorRole: "user",
          email: user.email,
          message: parsed.data.message,
        },
      }),
      prisma.supportTicket.update({
        where: { id: ticketId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return NextResponse.json({ message: msg });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// «Проблема решена»: пользователь закрывает свой тикет сам.
export async function PATCH(_req: Request, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { ticketId } = await params;
  try {
    const ticket = await ownTicket(user.userId, ticketId);
    if (!ticket) return badRequest("Обращение не найдено");
    if (ticket.status === "closed") return NextResponse.json({ ticket });
    const updated = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: "closed", closedAt: new Date() },
    });
    return NextResponse.json({ ticket: updated });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
