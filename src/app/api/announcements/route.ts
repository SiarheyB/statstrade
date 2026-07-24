import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const showAll = url.searchParams.get("all") === "1";

  try {
    const announcements = await prisma.announcement.findMany({
      where: showAll ? {} : { active: true },
      include: {
        reads: {
          where: { userId: user.userId },
          select: { readAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      announcements: announcements.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        active: a.active,
        createdAt: a.createdAt.toISOString(),
        readAt: a.reads[0]?.readAt.toISOString() ?? null,
      })),
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}