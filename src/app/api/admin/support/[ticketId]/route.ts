import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ticketId: string }> };

// Полная переписка одного тикета. Открытие отмечает сообщения юзера
// прочитанными (снимает бейдж в инбоксе и общем счётчике).
export async function GET(_req: Request, { params }: Params) {
  const session = await getAdminSession();
  if (!session) return notFound();
  const { ticketId } = await params;
  try {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return badRequest("Тикет не найден");
    const [messages, user] = await Promise.all([
      prisma.supportMessage.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } }),
      prisma.user.findUnique({ where: { id: ticket.userId }, select: { email: true, name: true } }),
    ]);
    await prisma.supportMessage.updateMany({
      where: { ticketId, authorRole: "user", readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ ticket, messages, user });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.object({ message: z.string().trim().min(1, "Введите сообщение").max(4000) });

// Ответ администратора в тикет (в т.ч. закрытый — статус не меняется).
export async function POST(req: Request, { params }: Params) {
  const session = await getAdminSession();
  if (!session) return notFound();
  const { ticketId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Проверьте сообщение");

  try {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return badRequest("Тикет не найден");

    const [msg] = await prisma.$transaction([
      prisma.supportMessage.create({
        data: {
          ticketId,
          userId: ticket.userId,
          authorRole: "admin",
          email: session.email,
          message: parsed.data.message,
        },
      }),
      prisma.supportTicket.update({
        where: { id: ticketId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    await recordAudit(session, "support.reply", { targetType: "SupportTicket", targetId: ticketId });
    return NextResponse.json({ message: msg });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const patchSchema = z.object({ status: z.enum(["open", "closed"]) });

// Закрыть / переоткрыть тикет.
export async function PATCH(req: Request, { params }: Params) {
  const session = await getAdminSession();
  if (!session) return notFound();
  const { ticketId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return badRequest("Некорректный статус");

  try {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return badRequest("Тикет не найден");
    const updated = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: parsed.data.status,
        closedAt: parsed.data.status === "closed" ? new Date() : null,
      },
    });
    await recordAudit(session, `support.${parsed.data.status === "closed" ? "close" : "reopen"}`, {
      targetType: "SupportTicket",
      targetId: ticketId,
    });
    return NextResponse.json({ ticket: updated });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
