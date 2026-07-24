import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: { announcementId?: string };
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }

  if (!body.announcementId || typeof body.announcementId !== "string") {
    return badRequest("announcementId is required");
  }

  try {
    await prisma.announcementRead.upsert({
      where: {
        userId_announcementId: {
          userId: user.userId,
          announcementId: body.announcementId,
        },
      },
      create: {
        userId: user.userId,
        announcementId: body.announcementId,
      },
      update: {},
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}