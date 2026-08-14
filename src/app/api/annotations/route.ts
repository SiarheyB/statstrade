import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { bumpStatsVersion } from "@/lib/statsCache";
import { recomputeRRForTradeKey } from "@/lib/analytics/rr";

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

  // tradeKey принимался любой. Сама аннотация создаётся в строке автора и
  // чужие цифры не искажает (recomputeRRForTradeKey читает аннотацию ВЛАДЕЛЬЦА
  // сделки), но пересчёт при этом идёт по чужому аккаунту: перезаписывается
  // чужой Trade.rr и пересобираются чужие часовые агрегаты. То есть чужой
  // ключ — это способ бесплатно нагружать чужие данные записью.
  //
  // accountId — префикс до первого двоеточия и для крипты (Trade.id), и для
  // импортированных ("accountId:externalId"), см. lib/analytics/rr.ts.
  const sep = tradeKey.indexOf(":");
  const accountId = sep === -1 ? tradeKey : tradeKey.slice(0, sep);
  const owner = await prisma.exchangeAccount.findUnique({
    where: { id: accountId },
    select: { userId: true },
  });
  // Аккаунта нет — атаковать нечего, пусть аннотация сохранится (так же, как
  // раньше). Аккаунт есть и он чужой — отказ.
  if (owner && owner.userId !== user.userId) {
    return badRequest("Сделка не найдена");
  }

  try {
    const result = await prisma.tradeAnnotation.upsert({
      where: { userId_tradeKey: { userId: user.userId, tradeKey } },
      create: { userId: user.userId, tradeKey, ...data },
      update: data,
    });
    // stopLoss — единственное поле аннотации, влияющее на RR; остальные
    // (ТВХ, паттерн и т.п.) его не трогают, пересчёт им не нужен.
    if (parsed.data.stopLoss !== undefined) {
      await recomputeRRForTradeKey(tradeKey).catch(() => {});
    }
    bumpStatsVersion(user.userId);
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
