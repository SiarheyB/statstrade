import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

// Пороги «только крупные лимитки» (в монетах базового актива) — по символу И
// рынку (spot | futures), свои лимиты на каждый рынок. Коллектор перечитывает
// таблицу CollectorConfig каждые ~30с.

export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  const items = await prisma.collectorConfig.findMany({
    orderBy: [{ symbol: "asc" }, { market: "asc" }],
  });
  return NextResponse.json({ items });
}

const schema = z.object({
  items: z
    .array(
      z.object({
        symbol: z.string().min(3).max(20).transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")),
        market: z.enum(["spot", "futures"]),
        // «Отбирать всё» — порог игнорируется; иначе minCoins обязателен и > 0.
        collectAll: z.boolean().default(false),
        minCoins: z.number().min(0).max(1e9).default(0),
      }).refine((it) => it.collectAll || it.minCoins > 0, {
        message: "Укажите порог или включите «отбирать всё»",
      }),
    )
    .max(200),
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
        where: { symbol_market: { symbol: it.symbol, market: it.market } },
        create: { symbol: it.symbol, market: it.market, minCoins: it.minCoins, collectAll: it.collectAll },
        update: { minCoins: it.minCoins, collectAll: it.collectAll },
      });
    }
    await recordAudit(session, "collector.config.update", {
      targetType: "CollectorConfig",
      detail: parsed.data.items.map((i) => `${i.symbol}/${i.market}=${i.collectAll ? "all" : i.minCoins}`).join(", "),
    });
    const items = await prisma.collectorConfig.findMany({
      orderBy: [{ symbol: "asc" }, { market: "asc" }],
    });
    return NextResponse.json({ items });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Удалить порог символа для рынка (вернётся к встроенному дефолту коллектора).
// Без market — удаляются оба рынка символа.
export async function DELETE(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const market = url.searchParams.get("market");
  if (!symbol) return badRequest("Не указан символ");
  try {
    await prisma.collectorConfig.deleteMany({
      where: { symbol, ...(market === "spot" || market === "futures" ? { market } : {}) },
    });
    await recordAudit(session, "collector.config.delete", {
      targetType: "CollectorConfig",
      targetId: `${symbol}${market ? `/${market}` : ""}`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
