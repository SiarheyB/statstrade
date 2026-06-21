import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";

const schema = z.object({
  tradeKey: z.string().min(1).max(200),
  entryPoint: z.string().max(40).nullable().optional(),
  entryType: z.string().max(40).nullable().optional(),
  mistake: z.string().max(60).nullable().optional(),
  pattern: z.string().max(60).nullable().optional(),
  stopLoss: z.number().positive().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

// Upsert the manual annotation for a single reconstructed trade.
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

  const entryPoint = parsed.data.entryPoint?.trim() || null;
  const entryType = parsed.data.entryType?.trim() || null;
  const mistake = parsed.data.mistake?.trim() || null;
  const pattern = parsed.data.pattern?.trim() || null;
  const stopLoss = parsed.data.stopLoss ?? null;
  const note = parsed.data.note?.trim() || null;
  const { tradeKey } = parsed.data;

  const data = { entryPoint, entryType, mistake, pattern, stopLoss, note };

  try {
    const result = await prisma.tradeAnnotation.upsert({
      where: { userId_tradeKey: { userId: user.userId, tradeKey } },
      create: { userId: user.userId, tradeKey, ...data },
      update: data,
    });
    return NextResponse.json({
      tradeKey: result.tradeKey,
      entryPoint: result.entryPoint,
      entryType: result.entryType,
      mistake: result.mistake,
      pattern: result.pattern,
      stopLoss: result.stopLoss,
      note: result.note,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
