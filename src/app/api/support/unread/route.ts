import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

// Есть ли непрочитанные ответы админа в своём треде — для точки-индикатора на
// кнопке «Поддержка» в меню.
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const count = await prisma.supportMessage.count({
      where: { userId: user.userId, authorRole: "admin", readAt: null },
    });
    return NextResponse.json({ count });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
