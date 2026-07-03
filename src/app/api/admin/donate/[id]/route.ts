import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  network: z.string().trim().min(1).max(60).optional(),
  coin: z.string().trim().min(1).max(20).optional(),
  address: z.string().trim().min(4).max(200).optional(),
  enabled: z.boolean().optional(),
});

// Изменить кошелёк (сеть/монета/адрес) и/или включить-выключить показ юзерам.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) return notFound();
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return badRequest("Проверьте данные", parsed.error.flatten().fieldErrors);
  if (Object.keys(parsed.data).length === 0) return badRequest("Нет изменений");

  try {
    await prisma.donateWallet.update({ where: { id }, data: parsed.data });
    await recordAudit(session, "donate.update", {
      targetType: "DonateWallet",
      targetId: id,
      detail: Object.entries(parsed.data).map(([k, v]) => `${k}=${v}`).join(", "),
    });
    const wallets = await prisma.donateWallet.findMany({ orderBy: { sortOrder: "asc" } });
    return NextResponse.json({ wallets });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) return notFound();
  const { id } = await params;

  try {
    await prisma.donateWallet.delete({ where: { id } }).catch(() => {});
    await recordAudit(session, "donate.delete", { targetType: "DonateWallet", targetId: id });
    const wallets = await prisma.donateWallet.findMany({ orderBy: { sortOrder: "asc" } });
    return NextResponse.json({ wallets });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
