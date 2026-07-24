import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
});

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (session instanceof Response) return session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Проверьте данные", parsed.error.flatten().fieldErrors);
  }

  try {
    const announcement = await prisma.announcement.create({
      data: {
        title: parsed.data.title,
        body: parsed.data.body,
      },
    });

    await recordAudit(session, "announcement.create", {
      targetType: "announcement",
      targetId: announcement.id,
      targetLabel: announcement.title,
    });

    return NextResponse.json({
      announcement: {
        id: announcement.id,
        title: announcement.title,
        body: announcement.body,
        createdAt: announcement.createdAt.toISOString(),
      },
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}