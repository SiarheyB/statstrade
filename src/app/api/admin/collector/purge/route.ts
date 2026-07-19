import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Ручная очистка истории карты ордеров: удаляет строки старше `before` во всех
// таблицах Ob*. Авто-ретеншн (коллектор pruneOld) чистит все партиционированные
// таблицы по RETENTION_DAYS — этот эндпоинт для принудительной очистки старше
// ретеншна или удаления rollup-таблиц (ObSnapshotRollup, ObRollupBucket).

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
    // Партиционированные t-таблицы: целые дни до `before` сбрасываем DROP'ом
    // партиций (мгновенно, без bloat'а), остаток внутри граничного дня — DELETE.
    const partitioned = ["ObSnapshot", "ObTrade", "ObFootprint", "ObBigTrade"] as const;
    let droppedPartitions = 0;
    for (const tbl of partitioned) {
      const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT ob_drop_partitions_before('${tbl}', $1) AS n`,
        before,
      );
      droppedPartitions += r[0]?.n ?? 0;
    }
    const [snap, trade, foot, big, rollup, bucket] = await Promise.all([
      prisma.$executeRaw`DELETE FROM "ObSnapshot" WHERE "t" < ${before}`,
      prisma.$executeRaw`DELETE FROM "ObTrade" WHERE "t" < ${before}`,
      prisma.$executeRaw`DELETE FROM "ObFootprint" WHERE "t" < ${before}`,
      prisma.$executeRaw`DELETE FROM "ObBigTrade" WHERE "t" < ${before}`,
      prisma.$executeRaw`DELETE FROM "ObSnapshotRollup" WHERE "bucket" < ${before}`,
      prisma.$executeRaw`DELETE FROM "ObRollupBucket" WHERE "bucket" < ${before}`,
    ]);
    const deleted = { snap, trade, foot, big, rollup, bucket, droppedPartitions };
    const total = snap + trade + foot + big + rollup + bucket;
    await recordAudit(session, "collector.purge", {
      targetType: "orderflow-history",
      detail: `before=${before.toISOString()} deleted=${total} partitions=${droppedPartitions}`,
    });
    return NextResponse.json({ ok: true, before: before.toISOString(), deleted, total });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Границы истории (самая старая/новая запись) — чтобы админка предлагала пресеты
// «первый месяц / 3 месяца / год».
export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const rows = await prisma.$queryRaw<{ oldest: Date | null; newest: Date | null }[]>`
      SELECT min("bucket") AS oldest, max("bucket") AS newest FROM "ObSnapshotRollup"
    `;
    return NextResponse.json({ oldest: rows[0]?.oldest ?? null, newest: rows[0]?.newest ?? null });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
