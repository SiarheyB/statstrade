import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/crypto";
import { startRecompute } from "@/lib/recommendations/progress";
import { recordCronRun } from "@/lib/cronHeartbeat";

export const maxDuration = 60;

// Token-protected endpoint for external cron platforms (system cron etc.).
// Тот же секрет, что у /api/cron/sync — см. docs/SELF_HOSTING.md.
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
  // Через тот же job-раннер, что и админская кнопка: ночной прогон виден в
  // прогресс-баре админки, а параллельный запуск двух пересчётов исключён.
  const { started, done } = startRecompute();
  // Отметку ставим сразу по факту вызова, а не после завершения: прогон идёт
  // дольше, чем крон готов ждать (curl обычно рвёт соединение по --max-time),
  // и админка должна видеть «автоматика приходила» даже в этом случае.
  await recordCronRun("recommendations.recompute", "cron");
  const result = await done;
  return NextResponse.json({ ok: true, started, ...result });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
