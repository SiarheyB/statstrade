import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";
import { syncChunk } from "@/lib/sync";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Админские действия над любым биржевым аккаунтом (вне зависимости от владельца):
//  - reset: сбросить зависший статус синхронизации в idle
//  - sync:  запустить один чанк синхронизации (rescan)
export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let body: { id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const { id, action } = body;
  if (!id || !action) return badRequest("Нужны id и action");

  const account = await prisma.exchangeAccount.findUnique({ where: { id } });
  if (!account) return badRequest("Аккаунт не найден");

  try {
    if (action === "reset") {
      await prisma.exchangeAccount.update({
        where: { id },
        data: { syncStatus: "idle", syncError: null },
      });
      await recordAudit(session, "account.reset", { targetType: "account", targetId: id, targetLabel: `${account.exchange} · ${account.label}` });
      return NextResponse.json({ ok: true });
    }
    if (action === "sync") {
      if (account.source !== "exchange") return badRequest("Синхронизация доступна только для биржевых аккаунтов (CCXT)");
      const progress = await syncChunk(id, { rescan: true });
      await recordAudit(session, "account.sync", { targetType: "account", targetId: id, targetLabel: `${account.exchange} · ${account.label}` });
      return NextResponse.json({ ok: true, progress });
    }
    return badRequest("Неизвестное действие");
  } catch (err) {
    return serverError((err as Error).message);
  }
}
