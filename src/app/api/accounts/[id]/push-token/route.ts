import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest } from "@/lib/api";
import { newPushToken, hashPushToken } from "@/lib/mt/push";

async function ownMtAccount(userId: string, id: string) {
  return prisma.exchangeAccount.findFirst({
    // Советник TradeGridPanel — MQL5, поэтому только MT5.
    where: { id, userId, source: "mt5" },
    select: { id: true },
  });
}

/**
 * POST — выдать токен для советника (старый, если был, перестаёт работать).
 * Токен возвращается ОДИН раз: в базе остаётся только его sha256.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await params;
  if (!(await ownMtAccount(user.userId, id))) return badRequest("Аккаунт не найден");

  const token = newPushToken();
  await prisma.exchangeAccount.update({
    where: { id },
    data: { pushTokenHash: hashPushToken(token), pushTokenCreatedAt: new Date() },
  });
  return NextResponse.json({ token });
}

/** DELETE — отозвать токен: советник больше не сможет выгружать сделки. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await params;
  if (!(await ownMtAccount(user.userId, id))) return badRequest("Аккаунт не найден");

  await prisma.exchangeAccount.update({
    where: { id },
    data: { pushTokenHash: null, pushTokenCreatedAt: null },
  });
  return NextResponse.json({ ok: true });
}
