import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";

// All diary notes for the current user, keyed by date (YYYY-MM-DD).
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const notes = await prisma.journalNote.findMany({
    where: { userId: user.userId },
    select: { date: true, text: true },
  });
  const map: Record<string, string> = {};
  for (const n of notes) map[n.date] = n.text;
  return NextResponse.json({ notes: map });
}

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  text: z.string().max(5000),
});

// Upsert (or clear) a single day's diary note.
export async function PUT(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Проверьте данные", parsed.error.flatten().fieldErrors);
  }
  const { date } = parsed.data;
  const text = parsed.data.text.trim();

  try {
    if (!text) {
      await prisma.journalNote
        .delete({ where: { userId_date: { userId: user.userId, date } } })
        .catch(() => {});
      return NextResponse.json({ date, text: "" });
    }
    const note = await prisma.journalNote.upsert({
      where: { userId_date: { userId: user.userId, date } },
      create: { userId: user.userId, date, text },
      update: { text },
    });
    return NextResponse.json({ date: note.date, text: note.text });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
