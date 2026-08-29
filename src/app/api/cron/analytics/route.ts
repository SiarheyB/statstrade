// Ночная свёртка посещаемости: суточные агрегаты + чистка сырых просмотров.
// Дёргается системным кроном хоста тем же CRON_SECRET, что /api/cron/sync
// (см. docs/SELF_HOSTING.md). Без этой задачи таблица PageView растёт вечно.

import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/crypto";
import { rollupTraffic } from "@/lib/traffic/rollup";
import { recordCronRun } from "@/lib/cronHeartbeat";
import { runTrafficAlerts } from "@/lib/traffic/alerts";
import { pruneErrorLog } from "@/lib/errorLog";

export const runtime = "nodejs";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return secretEquals(req.headers.get("authorization"), `Bearer ${secret}`);
}

async function handle(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET не задан" }, { status: 500 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  // Пересчитываем не только вчера, а последние трое суток: если сервер был
  // выключен (домашний мини-ПК), пропущенные дни доедутся следующим прогоном.
  const result = await rollupTraffic(3);
  // Суточные проверки (в т.ч. обвал посещаемости) — здесь: сравнение с
  // недельным средним имеет смысл раз в сутки, а не на каждом событии.
  const alerts = await runTrafficAlerts("daily");
  // Заодно подрезаем журнал ошибок: своей задачи у него не было, а пишет туда
  // не только serverError(), но и оповещения о трафике (см. lib/errorLog.ts).
  const errorsPruned = await pruneErrorLog();
  await recordCronRun("analytics.rollup", "cron");
  return NextResponse.json({ ok: true, ...result, errorsPruned, alerts: alerts.map((a) => a.kind) });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
