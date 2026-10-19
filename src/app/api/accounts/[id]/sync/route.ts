import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { syncChunk, AccountGoneError } from "@/lib/sync";
import { rateLimit } from "@/lib/ratelimit";

// One chunk of a chunked background import. The client calls this repeatedly
// (while status === "syncing") to walk the scan and render a progress bar.
// Kept under the Hobby plan's 60s function limit.
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const account = await prisma.exchangeAccount.findFirst({
    where: { id, userId: user.userId },
  });
  if (!account) return badRequest("Аккаунт не найден");

  let rescan = false;
  try {
    const body = await req.json();
    rescan = !!body?.rescan;
  } catch {
    // no body is fine
  }

  // Лимит считается по СТАРТАМ сканирования, а не по запросам: клиент
  // (components/SyncProvider.tsx) гоняет чанки подряд без паузы, пока
  // status === "syncing", и лимит «N запросов в минуту» оборвал бы законный
  // импорт на середине. Дорог именно старт — он заново обходит всю историю
  // счёта и жжёт квоту биржи.
  const isContinuation =
    !rescan && account.syncStatus === "syncing" && !!account.syncPlan;
  const limit = isContinuation
    // Потолок на продолжения: выше guard-а клиента (500 чанков за проход),
    // поэтому законный импорт его не достанет, а бесконечный долбёж — да.
    ? rateLimit(`sync-chunk:${user.userId}:${id}`, 600, 10 * 60_000)
    : rateLimit(`sync-start:${user.userId}:${id}`, 10, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Слишком частая синхронизация, попробуйте позже" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  try {
    const progress = await syncChunk(id, { rescan });
    return NextResponse.json(progress);
  } catch (err) {
    // Аккаунт удалили, пока шёл чанк — это не ошибка сервера.
    if (err instanceof AccountGoneError) return badRequest("Аккаунт не найден");
    return serverError((err as Error).message);
  }
}
