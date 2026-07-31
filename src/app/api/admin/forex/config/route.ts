import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

// Список валютных пар forex-collector — FxCollectorConfig. Коллектор
// перечитывает эту таблицу раз в ~60с; если она пуста, использует ENV
// FX_SYMBOLS как фоллбек (см. collector/forex/index.mjs).

// Форекс-пары форматом "XXX/YYY" (Twelve Data / Finnhub OANDA:XXX_YYY).
const SYMBOL_RE = /^[A-Z]{3}\/[A-Z]{3}$/;
const symbolSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => SYMBOL_RE.test(s), { message: "Формат пары: EUR/USD (3 буквы / 3 буквы)" });

export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  const items = await prisma.fxCollectorConfig.findMany({ orderBy: { symbol: "asc" } });
  return NextResponse.json({ items });
}

const postSchema = z.object({ symbol: symbolSchema });

// Добавить пару (enabled=true по умолчанию).
export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Проверьте данные");

  try {
    const item = await prisma.fxCollectorConfig.upsert({
      where: { symbol: parsed.data.symbol },
      create: { symbol: parsed.data.symbol, enabled: true },
      update: { enabled: true },
    });
    await recordAudit(session, "forex.config.add", { targetType: "FxCollectorConfig", targetId: item.symbol });
    const items = await prisma.fxCollectorConfig.findMany({ orderBy: { symbol: "asc" } });
    return NextResponse.json({ items });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const patchSchema = z.object({ symbol: symbolSchema, enabled: z.boolean() });

// Включить/выключить пару без удаления (коллектор перестанет её собирать,
// но история в FxCandle останется).
export async function PATCH(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Проверьте данные");

  try {
    const item = await prisma.fxCollectorConfig.update({
      where: { symbol: parsed.data.symbol },
      data: { enabled: parsed.data.enabled },
    });
    await recordAudit(session, parsed.data.enabled ? "forex.config.enable" : "forex.config.disable", {
      targetType: "FxCollectorConfig",
      targetId: item.symbol,
    });
    const items = await prisma.fxCollectorConfig.findMany({ orderBy: { symbol: "asc" } });
    return NextResponse.json({ items });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Удалить пару из конфига целиком (коллектор перестанет собирать; свечи в
// FxCandle НЕ удаляются — для этого отдельная очистка).
export async function DELETE(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol || !SYMBOL_RE.test(symbol)) return badRequest("Не указана корректная пара");

  try {
    await prisma.fxCollectorConfig.delete({ where: { symbol } }).catch(() => {});
    await recordAudit(session, "forex.config.remove", { targetType: "FxCollectorConfig", targetId: symbol });
    const items = await prisma.fxCollectorConfig.findMany({ orderBy: { symbol: "asc" } });
    return NextResponse.json({ items });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
