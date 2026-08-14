import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { bucketByLocalDay, localDayKey, type HourBucket } from "@/lib/analytics/periods";
import { tzOffsetFromRequest } from "@/lib/tzParam";

// Дневная сетка «Календаря» — из почасовых агрегатов (TradeHourly).
//
// Раньше страница качала /api/stats БЕЗ фильтров (то есть всю историю сделок
// пользователя) и складывала дни в браузере. Теперь суммы уже посчитаны при
// изменении сделок, а здесь только сворачиваются в локальные сутки.
//
// День определяется по exitTime (P&L фиксируется при закрытии) в таймзоне
// пользователя — клиент присылает свой сдвиг в минутах (?tzOffset). Так
// «Календарь» показывает те же числа, что дашборд и риск-менеджер; до этого он
// бакетил по entryTime и расходился с ними на многодневных сделках.
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const offsetMinutes = tzOffsetFromRequest(req);
  const accountId = url.searchParams.get("accountId") ?? "all";
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");

  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  if (!from || Number.isNaN(from.getTime()) || !to || Number.isNaN(to.getTime())) {
    return badRequest("Нужен диапазон from/to");
  }
  if (to.getTime() <= from.getTime()) return badRequest("Некорректный диапазон");
  // Сетка календаря — это максимум 6 недель. Ограничение отсекает запросы,
  // которые вытянули бы всю историю аккаунта одним вызовом.
  if (to.getTime() - from.getTime() > 70 * 86_400_000) {
    return badRequest("Слишком широкий диапазон");
  }

  try {
    const accounts = await prisma.exchangeAccount.findMany({
      where: { userId: user.userId },
      select: { id: true, label: true, exchange: true },
      orderBy: { createdAt: "asc" },
    });
    const ownedIds = accounts.map((a) => a.id);
    const ids =
      accountId !== "all" && ownedIds.includes(accountId) ? [accountId] : ownedIds;

    if (ids.length === 0) {
      return NextResponse.json({ days: [], accounts, latest: null });
    }

    const [rows, latestRow] = await Promise.all([
      prisma.tradeHourly.findMany({
        where: { accountId: { in: ids }, hour: { gte: from, lt: to } },
        select: {
          hour: true, netPnl: true, wins: true, losses: true,
          winR: true, lossR: true, trades: true, rTrades: true,
        },
      }),
      // Последний торговый час — чтобы при первом открытии страница показала
      // месяц последней сделки, а не пустой текущий.
      prisma.tradeHourly.aggregate({
        where: { accountId: { in: ids } },
        _max: { hour: true },
      }),
    ]);

    const hours: HourBucket[] = rows;
    const latestHour = latestRow._max.hour;

    return NextResponse.json({
      days: bucketByLocalDay(hours, offsetMinutes),
      accounts,
      latest: latestHour ? localDayKey(latestHour.getTime(), offsetMinutes) : null,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
