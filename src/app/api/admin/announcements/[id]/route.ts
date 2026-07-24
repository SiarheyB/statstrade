import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, recordAudit } from "@/lib/admin";
import { serverError } from "@/lib/api";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (session instanceof Response) return session;

  const { id } = await params;

  try {
    const announcement = await prisma.announcement.findUnique({
      where: { id },
      select: { id: true, title: true, active: true },
    });

    if (!announcement) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.announcement.update({
      where: { id },
      data: { active: !announcement.active },
    });

    await recordAudit(session, announcement.active ? "announcement.hide" : "announcement.show", {
      targetType: "announcement",
      targetId: announcement.id,
      targetLabel: announcement.title,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}