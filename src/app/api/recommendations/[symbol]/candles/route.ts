import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { recommendationsAccessError } from "@/lib/recommendationsAccess";

const EXCHANGE = "binance-futures";
const INTERVAL = "1d";
// Сколько ждём биржу, прежде чем отдать то, что есть в БД. Карточка должна
// открываться быстро: живой бар — уточнение, а не обязательное условие.
const LIVE_BAR_TIMEOUT_MS = 2500;

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number | null };

/**
 * Сегодняшний (ещё не закрытый) дневной бар прямо с биржи.
 *
 * Зачем: свечи для рекомендаций пишет полный скан всех USDT-пар, а он идёт
 * РАЗ В СУТКИ (collector: scanAllUsdtPairsDaily). Ежеминутный сбор свечей
 * работает только по символам из watchlist коллектора, которых в выдаче
 * обычно нет. Без этого запроса «сегодня уже пройдено N×ATR» в карточке
 * показывало бы состояние на момент ночного скана: открыв страницу днём,
 * пользователь видел бы утренний размах бара, а не текущий.
 */
async function fetchLiveBar(symbol: string): Promise<Candle | null> {
  try {
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=1`,
      { cache: "no-store", signal: AbortSignal.timeout(LIVE_BAR_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const raw = (await res.json()) as unknown[][];
    const k = raw[0];
    if (!k) return null;
    const bar = {
      t: Number(k[0]),
      o: Number(k[1]),
      h: Number(k[2]),
      l: Number(k[3]),
      c: Number(k[4]),
      v: Number(k[5]),
    };
    return Number.isFinite(bar.t) && Number.isFinite(bar.h) && Number.isFinite(bar.l) ? bar : null;
  } catch {
    // Биржа недоступна/таймаут — не повод ронять карточку: ниже отдадим БД.
    return null;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const denied = await recommendationsAccessError(user);
  if (denied) return denied;

  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (symbol.length < 5) {
    return badRequest("Некорректный символ: минимальная длина 5 символов");
  }

  try {
    // Только по убыванию: `asc` + `take` отдал бы САМЫЕ СТАРЫЕ свечи, и на
    // картинке в карточке был бы кусок истории годичной давности вместо
    // подхода к уровню. Разворачиваем обратно в хронологический порядок —
    // его ждёт отрисовка на клиенте.
    const candles = await prisma.obCandle.findMany({
      where: { symbol, exchange: EXCHANGE, interval: INTERVAL },
      orderBy: { t: "desc" },
      take: 300,
    });
    const rows: Candle[] = candles
      .reverse()
      .map((c) => ({ t: c.t.getTime(), o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));

    // Последний бар заменяем живым (или дописываем, если сегодняшнего в БД
    // ещё нет). Только последний: история из БД уже закрыта и не меняется.
    const live = await fetchLiveBar(symbol);
    if (live) {
      const lastIdx = rows.length - 1;
      if (lastIdx >= 0 && rows[lastIdx].t === live.t) rows[lastIdx] = live;
      else if (lastIdx < 0 || live.t > rows[lastIdx].t) rows.push(live);
    }

    return NextResponse.json({
      symbol,
      exchange: EXCHANGE,
      interval: INTERVAL,
      // Клиент показывает, на какой момент актуален сегодняшний бар: свежий он
      // (с биржи) или из последнего суточного скана.
      liveBarAt: live ? Date.now() : null,
      candles: rows,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
