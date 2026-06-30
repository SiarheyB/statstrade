import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { bumpStatsVersion } from "@/lib/statsCache";
import { seedDemoData } from "@/lib/demo";

// Seed synthetic fills for this account so the dashboard can be explored
// without connecting a real exchange.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const account = await prisma.exchangeAccount.findFirst({
    where: { id, userId: user.userId },
  });
  if (!account) return badRequest("Аккаунт не найден");

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
