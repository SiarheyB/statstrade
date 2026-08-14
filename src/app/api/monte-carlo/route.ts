import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { runMonteCarlo } from "@/lib/analytics/monteCarlo";
import { getFeatureConfig } from "@/lib/featureConfig";
import { tradeNetPnls } from "@/lib/analytics/tradeReturns";

// Monte Carlo по историческим сделкам — СЧИТАЕТСЯ НА СЕРВЕРЕ.
//
// Раньше симуляция шла в браузере, и ради неё /api/stats отдавал туда весь
// массив сделок: из каждой использовался ровно один netPnl. Расчёт разовый
// (кнопка «Посчитать», без ползунков), поэтому держать данные на клиенте
// незачем — сюда едут только параметры, обратно готовый результат.
//
// Из БД тянем ОДНУ колонку netPnl, а не строки сделок.

export const maxDuration = 30;

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId") ?? "all";
  const market = url.searchParams.get("market") ?? "all";
  const capital = Number(url.searchParams.get("capital") ?? "0");
  if (!Number.isFinite(capital) || capital <= 0) {
    return badRequest("Нужен положительный капитал");
  }

  try {
    const feature = await getFeatureConfig("monteCarlo");
    if (!feature.enabled) return badRequest("Функция выключена администратором");

    const netPnls = await tradeNetPnls(user.userId, accountId, market);

    // Симуляции нужен минимум сделок, чтобы бутстрап имел смысл — тот же
    // порог, что стоял в карточке на клиенте.
    if (netPnls.length < 5) return NextResponse.json({ result: null, trades: netPnls.length });

    const returnsPct = netPnls.map((v) => v / capital);
    const result = runMonteCarlo(returnsPct, {
      simulations: feature.simulations,
      projectedTrades: feature.projectedTrades,
      ruinDrawdownPct: feature.ruinDrawdownPct,
    });

    return NextResponse.json({ result, trades: netPnls.length });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
