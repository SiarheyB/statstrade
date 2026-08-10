import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { prisma } from "@/lib/db";

// symbol здесь и так очищается регуляркой, а вот exchange принимался любой
// длины, и число избранных на пользователя ничем не ограничивалось.
const MAX_FAVOURITES_PER_USER = 200;
const EXCHANGE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** Приводит биржу к нижнему регистру и проверяет формат; null — не подходит. */
function normalizeExchange(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const ex = raw.toLowerCase();
  return EXCHANGE_RE.test(ex) ? ex : null;
}

// GET /api/liqmap/favorites?exchange=binance — list user's favourite tickers
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const exchange = normalizeExchange(url.searchParams.get("exchange"));
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
    const ex = normalizeExchange(exchange);
    if (!ex) return badRequest("Invalid exchange");
    if (typeof symbol !== "string" || symbol.length > 64) return badRequest("Invalid symbol");
    const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (sym.length < 3 || sym.length > 20) return badRequest("Invalid symbol");

    // Потолок на пользователя: иначе список избранного растёт неограниченно.
    const existing = await prisma.favouriteTicker.count({ where: { userId: user.userId } });
    if (existing >= MAX_FAVOURITES_PER_USER) {
      const already = await prisma.favouriteTicker.findUnique({
        where: { userId_exchange_symbol: { userId: user.userId, exchange: ex, symbol: sym } },
        select: { symbol: true },
      });
      // Повторное добавление уже избранного просто поднимает его наверх.
      if (!already) return badRequest(`Достигнут лимит избранного (${MAX_FAVOURITES_PER_USER})`);
    }

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
    const ex = normalizeExchange(exchange);
    if (!ex) return badRequest("Invalid exchange");
    if (typeof symbol !== "string" || symbol.length > 64) return badRequest("Invalid symbol");
    const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");

    await prisma.favouriteTicker.deleteMany({
      where: { userId: user.userId, exchange: ex, symbol: sym },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}