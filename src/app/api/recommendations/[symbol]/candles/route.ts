import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";

function featureDisabled() {
  return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
}

const EXCHANGE = "binance-futures";
const INTERVAL = "1d";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const feature = await getFeatureConfig("tradeRecommendations");
  if (!feature.enabled) return featureDisabled();

  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (symbol.length < 5) {
    return badRequest("Некорректный символ: минимальная длина 5 символов");
  }

  try {
    const candles = await prisma.obCandle.findMany({
      where: { symbol, exchange: EXCHANGE, interval: INTERVAL },
      orderBy: { t: "asc" },
      take: 300,
    });
    return NextResponse.json({
      symbol,
      exchange: EXCHANGE,
      interval: INTERVAL,
      candles: candles.map((c) => ({ t: c.t.getTime(), o: c.o, h: c.h, l: c.l, c: c.c })),
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
