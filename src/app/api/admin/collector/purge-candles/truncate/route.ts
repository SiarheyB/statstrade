import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { serverError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Полная очистка таблицы свечей ObCandle. После очистки коллектор автоматически
// запустит бэкафилл из Binance в течение ~60 секунд (следующий цикл
// fetchAndStoreCandles). Используется, когда нужно перезаполнить свечи с нуля
// (например, после смены реализации или исправления бага).

export async function POST() {
  const session = await getAdminSession();
  if (!session) return notFound();

  try {
    await prisma.$executeRawUnsafe(`TRUNCATE "ObCandle"`);
    await recordAudit(session, "collector.purge-candles", {
      targetType: "candles",
      detail: "truncate all",
    });
    return NextResponse.json({ ok: true, action: "truncate" });
  } catch (err) {
    return serverError((err as Error).message);
  }
}