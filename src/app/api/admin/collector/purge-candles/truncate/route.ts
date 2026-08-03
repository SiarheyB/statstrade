import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { serverError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Полная очистка таблицы свечей ObCandle. После очистки коллектор автоматически
// начнёт бэкафилл из Binance на следующем цикле fetchAndStoreCandles (раз в
// 60с) — но полная глубина (CANDLE_RETENTION_DAYS) для мелких таймфреймов
// (5m/15m) набирается заметно дольше 60с: Binance отдаёт максимум 1500 свечей
// за запрос, так что на год истории 5m нужно ~70 последовательных запросов на
// каждую пару symbol×exchange. Используется, когда нужно перезаполнить свечи
// с нуля (например, после смены реализации или исправления бага).

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