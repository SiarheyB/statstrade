import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const wallets = await prisma.donateWallet.findMany({ orderBy: { sortOrder: "asc" } });
    return NextResponse.json({ wallets });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const createSchema = z.object({
  network: z.string().trim().min(1).max(60),
  coin: z.string().trim().min(1).max(20),
  address: z.string().trim().min(4).max(200),
});

// Добавить новый кошелёк/сеть.
export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest("Проверьте данные", parsed.error.flatten().fieldErrors);

  try {
    const maxOrder = await prisma.donateWallet.aggregate({ _max: { sortOrder: true } });
    const wallet = await prisma.donateWallet.create({
      data: { ...parsed.data, sortOrder: (maxOrder._max.sortOrder ?? -1) + 1 },
    });
    await recordAudit(session, "donate.create", {
      targetType: "DonateWallet",
      targetId: wallet.id,
      detail: `${wallet.network} / ${wallet.coin}`,
    });
    const wallets = await prisma.donateWallet.findMany({ orderBy: { sortOrder: "asc" } });
    return NextResponse.json({ wallets });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
