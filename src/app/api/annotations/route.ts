import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { parseMistakes, serializeMistakes } from "@/lib/annotations";

const schema = z.object({
  tradeKey: z.string().min(1).max(200),
  entryPoint: z.string().max(40).nullable().optional(),
  entryType: z.string().max(40).nullable().optional(),
  mistakes: z.array(z.string().max(60)).max(20).optional(),
  pattern: z.string().max(60).nullable().optional(),
  stopLoss: z.number().positive().nullable().optional(),
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
  const mistake = serializeMistakes(parsed.data.mistakes ?? []);
  const pattern = parsed.data.pattern?.trim() || null;
  const stopLoss = parsed.data.stopLoss ?? null;
  const { tradeKey } = parsed.data;

  const data = { entryPoint, entryType, mistake, pattern, stopLoss };

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
      mistakes: parseMistakes(result.mistake),
      pattern: result.pattern,
      stopLoss: result.stopLoss,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
