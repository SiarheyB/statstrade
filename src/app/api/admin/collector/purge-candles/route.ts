import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Ручная очистка свечей (ObCandle). Свечи — лёгкие данные, чистятся только
// вручную из админки (авто-ретеншна нет в отличие от партиционированных Ob*).

const schema = z.object({ before: z.string().datetime() });

export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Укажите корректную дату (before)");
  const before = new Date(parsed.data.before);

  try {
    const deleted = await prisma.$executeRaw`DELETE FROM "ObCandle" WHERE "t" < ${before}`;
    await recordAudit(session, "collector.purge-candles", {
      targetType: "candles",
      detail: `before=${before.toISOString()} deleted=${deleted}`,
    });
    return NextResponse.json({ ok: true, before: before.toISOString(), deleted });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Границы истории свечей — чтобы админка предлагала пресеты.
export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const rows = await prisma.$queryRaw<{ oldest: Date | null; newest: Date | null }[]>`
      SELECT min("t") AS oldest, max("t") AS newest FROM "ObCandle"
    `;
    return NextResponse.json({ oldest: rows[0]?.oldest ?? null, newest: rows[0]?.newest ?? null });
  } catch (err) {
    return serverError((err as Error).message);
  }
}