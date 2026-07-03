import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

// Пороги «только крупные лимитки» (в монетах базового актива), по символу.
// Коллектор перечитывает таблицу CollectorConfig каждые ~30с.

export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  const items = await prisma.collectorConfig.findMany({ orderBy: { symbol: "asc" } });
  return NextResponse.json({ items });
}

const schema = z.object({
  items: z
    .array(
      z.object({
        symbol: z.string().min(3).max(20).transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")),
        minCoins: z.number().positive().max(1e9),
      }),
    )
    .max(100),
});

export async function PUT(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Проверьте данные", parsed.error.flatten());

  try {
    for (const it of parsed.data.items) {
      await prisma.collectorConfig.upsert({
        where: { symbol: it.symbol },
        create: { symbol: it.symbol, minCoins: it.minCoins },
        update: { minCoins: it.minCoins },
      });
    }
    await recordAudit(session, "collector.config.update", {
      targetType: "CollectorConfig",
      detail: parsed.data.items.map((i) => `${i.symbol}=${i.minCoins}`).join(", "),
    });
    const items = await prisma.collectorConfig.findMany({ orderBy: { symbol: "asc" } });
    return NextResponse.json({ items });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Удалить порог для символа (вернётся к встроенному дефолту коллектора).
export async function DELETE(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();
  const symbol = new URL(req.url).searchParams.get("symbol")?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol) return badRequest("Не указан символ");
  try {
    await prisma.collectorConfig.deleteMany({ where: { symbol } });
    await recordAudit(session, "collector.config.delete", { targetType: "CollectorConfig", targetId: symbol });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
