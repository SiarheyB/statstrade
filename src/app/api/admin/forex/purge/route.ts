import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Ручная очистка свечей форекса (FxCandle). Автоматическая чистка уже
// делается коллектором по FX_CANDLE_RETENTION_DAYS — это на случай, если
// нужно почистить раньше срока (например, после смены источника/бага).

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
    const deleted = await prisma.$executeRaw`DELETE FROM "FxCandle" WHERE "t" < ${before}`;
    await recordAudit(session, "forex.purge-candles", {
      targetType: "FxCandle",
      detail: `before=${before.toISOString()} deleted=${deleted}`,
    });
    return NextResponse.json({ ok: true, before: before.toISOString(), deleted });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Границы истории — чтобы админка предлагала пресеты.
export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const rows = await prisma.$queryRaw<{ oldest: Date | null; newest: Date | null }[]>`
      SELECT min("t") AS oldest, max("t") AS newest FROM "FxCandle" WHERE exchange = 'finnhub'
    `;
    return NextResponse.json({ oldest: rows[0]?.oldest ?? null, newest: rows[0]?.newest ?? null });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
