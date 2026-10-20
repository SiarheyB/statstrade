import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { bumpStatsVersion } from "@/lib/statsCache";
import { seedDemoData, removeDemoData, countRealFills, DEMO_BALANCE } from "@/lib/demo";

// Seed synthetic fills for this account so the dashboard can be explored
// without connecting a real exchange.
//
// На счёте с НАСТОЯЩИМИ сделками кнопка «Демо» — чистая беда: синтетика
// подмешивается в статистику рабочего счёта. Поэтому сид отказывает (409),
// пока вызывающий явно не подтвердит force: пользователю это подтверждение
// показывает страница счетов.
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

  const force = new URL(req.url).searchParams.get("force") === "1";
  const realFills = await countRealFills(id);
  if (realFills > 0 && !force) {
    return NextResponse.json(
      {
        error: "На счёте уже есть реальные сделки — демо-данные не загружены",
        code: "has_real_fills",
        realFills,
      },
      { status: 409 },
    );
  }

  try {
    const count = await seedDemoData(id, account.exchange, user.userId);
    await prisma.exchangeAccount.update({
      where: { id },
      data: { lastSyncAt: new Date(), syncStatus: "idle", syncError: null },
    });
    bumpStatsVersion(user.userId);
    return NextResponse.json({ imported: count });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Откат демо-данных: сносит только филлы с префиксом demo- и аннотации их
// сделок. Реальные сделки счёта не трогаются.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const account = await prisma.exchangeAccount.findFirst({
    where: { id, userId: user.userId },
    select: { id: true, balance: true },
  });
  if (!account) return badRequest("Аккаунт не найден");

  try {
    const deleted = await removeDemoData(id, user.userId);
    // Демо-депозит ставится, только когда баланса не было (см. seedDemoData),
    // поэтому и снимаем его лишь когда он совпадает с демо-значением и живых
    // филлов на счёте не осталось.
    const realFills = await countRealFills(id);
    const clearBalance = realFills === 0 && account.balance === DEMO_BALANCE;
    await prisma.exchangeAccount.update({
      where: { id },
      data: {
        syncStatus: "idle",
        syncError: null,
        ...(clearBalance ? { balance: null, balanceAt: null } : {}),
      },
    });
    bumpStatsVersion(user.userId);
    return NextResponse.json({ deleted });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
