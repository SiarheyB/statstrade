import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

// Полная переписка с одним пользователем. Открытие треда отмечает его
// сообщения прочитанными (снимает бейдж как в инбоксе, так и в общем счётчике).
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await getAdminSession();
  if (!session) return notFound();
  const { userId } = await params;
  try {
    const [messages, user] = await Promise.all([
      prisma.supportMessage.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
    ]);
    await prisma.supportMessage.updateMany({
      where: { userId, authorRole: "user", readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ messages, user });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.object({ message: z.string().trim().min(1, "Введите сообщение").max(4000) });

// Ответ администратора в тред пользователя.
export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await getAdminSession();
  if (!session) return notFound();
  const { userId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Проверьте сообщение");

  try {
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) return badRequest("Пользователь не найден");

    const msg = await prisma.supportMessage.create({
      data: { userId, authorRole: "admin", email: session.email, message: parsed.data.message },
    });
    await recordAudit(session, "support.reply", { targetType: "User", targetId: userId });
    return NextResponse.json({ message: msg });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
