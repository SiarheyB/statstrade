import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest } from "@/lib/api";

// Ensure the account belongs to the current user.
async function ownAccount(userId: string, id: string) {
  return prisma.exchangeAccount.findFirst({ where: { id, userId } });
}

const patchSchema = z.object({
  autoSync: z.boolean().optional(),
  syncIntervalMinutes: z.number().int().min(5).max(1440).optional(),
});

// Update auto-sync settings for an account.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const account = await ownAccount(user.userId, id);
  if (!account) return badRequest("Аккаунт не найден");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Проверьте данные", parsed.error.flatten().fieldErrors);
  }

  const updated = await prisma.exchangeAccount.update({
    where: { id },
    data: parsed.data,
    select: { autoSync: true, syncIntervalMinutes: true },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const account = await ownAccount(user.userId, id);
  if (!account) return badRequest("Аккаунт не найден");

  await prisma.exchangeAccount.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
