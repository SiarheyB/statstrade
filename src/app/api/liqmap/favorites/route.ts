import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { prisma } from "@/lib/db";

// GET /api/liqmap/favorites?exchange=binance — list user's favourite tickers
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const exchange = url.searchParams.get("exchange")?.toLowerCase() ?? "";
  if (!exchange) return badRequest("Exchange is required");

  try {
    const favs = await prisma.favouriteTicker.findMany({
      where: { userId: user.userId, exchange },
      orderBy: { createdAt: "desc" },
      select: { symbol: true },
    });
    return NextResponse.json({ symbols: favs.map((f) => f.symbol) });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// POST /api/liqmap/favorites — add a favourite ticker
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    const { exchange, symbol } = (await req.json()) as {
      exchange?: string;
      symbol?: string;
    };
    if (!exchange || !symbol) return badRequest("exchange and symbol are required");
    const ex = exchange.toLowerCase();
    const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (sym.length < 3 || sym.length > 20) return badRequest("Invalid symbol");

    await prisma.favouriteTicker.upsert({
      where: { userId_exchange_symbol: { userId: user.userId, exchange: ex, symbol: sym } },
      update: { createdAt: new Date() }, // bump to top on re-add
      create: { userId: user.userId, exchange: ex, symbol: sym },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// DELETE /api/liqmap/favorites — remove a favourite ticker
export async function DELETE(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    const { exchange, symbol } = (await req.json()) as {
      exchange?: string;
      symbol?: string;
    };
    if (!exchange || !symbol) return badRequest("exchange and symbol are required");
    const ex = exchange.toLowerCase();
    const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");

    await prisma.favouriteTicker.deleteMany({
      where: { userId: user.userId, exchange: ex, symbol: sym },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}