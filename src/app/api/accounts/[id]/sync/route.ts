import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { syncAccount } from "@/lib/sync";

// Long-running: fetches trades from the exchange. Keep generous timeout.
export const maxDuration = 120;

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

  let sinceDays = 180;
  try {
    const body = await req.json();
    if (typeof body?.sinceDays === "number") sinceDays = body.sinceDays;
  } catch {
    // no body is fine
  }

  try {
    const result = await syncAccount(id, { sinceDays });
    return NextResponse.json(result);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
