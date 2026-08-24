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

// Либо «всё старше даты» (чистка истории), либо «всё по одной паре» —
// второе нужно, когда пару сняли со сбора: её свечи иначе остаются в
// FxCandle навсегда и продолжают висеть в таблице админки как отстающие.
const SYMBOL_RE = /^[A-Z]{3}\/[A-Z]{3}$/;
const schema = z
  .object({
    before: z.string().datetime().optional(),
    symbol: z
      .string()
      .transform((v) => v.trim().toUpperCase())
      .refine((v) => SYMBOL_RE.test(v), { message: "Формат пары: EUR/USD" })
      .optional(),
  })
  .refine((v) => v.before || v.symbol, { message: "Укажите before или symbol" });

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
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Укажите корректную дату (before) или пару (symbol)");
  }
  const { symbol } = parsed.data;
  const before = parsed.data.before ? new Date(parsed.data.before) : null;

  try {
    let deleted: number;
    if (symbol && before) {
      deleted = await prisma.$executeRaw`DELETE FROM "FxCandle" WHERE "symbol" = ${symbol} AND "t" < ${before}`;
    } else if (symbol) {
      deleted = await prisma.$executeRaw`DELETE FROM "FxCandle" WHERE "symbol" = ${symbol}`;
    } else {
      deleted = await prisma.$executeRaw`DELETE FROM "FxCandle" WHERE "t" < ${before!}`;
    }
    await recordAudit(session, "forex.purge-candles", {
      targetType: "FxCandle",
      targetId: symbol,
      detail: `${symbol ? `symbol=${symbol} ` : ""}${before ? `before=${before.toISOString()} ` : ""}deleted=${deleted}`,
    });
    return NextResponse.json({ ok: true, symbol: symbol ?? null, before: before?.toISOString() ?? null, deleted });
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
