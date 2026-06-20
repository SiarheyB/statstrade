import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { verifyGoogleCredential, GoogleAuthError } from "@/lib/google";

// Whether the current account has a Google identity linked (for the settings UI).
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { googleId: true, password: true },
  });
  return NextResponse.json({ linked: !!row?.googleId, hasPassword: !!row?.password });
}

const schema = z.object({ credential: z.string().min(10) });

// Link a Google account to the signed-in user, so they can later sign in with Google.
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Некорректный запрос");

  let identity;
  try {
    identity = await verifyGoogleCredential(parsed.data.credential);
  } catch (err) {
    if (err instanceof GoogleAuthError && err.message === "not-configured") {
      return serverError("Google вход не настроен на сервере");
    }
    return badRequest("Не удалось проверить аккаунт Google");
  }

  try {
    // Reject if this Google account is already linked to a different user.
    const owner = await prisma.user.findUnique({
      where: { googleId: identity.googleId },
      select: { id: true },
    });
    if (owner && owner.id !== user.userId) {
      return badRequest("Этот аккаунт Google уже привязан к другому пользователю");
    }

    await prisma.user.update({
      where: { id: user.userId },
      data: { googleId: identity.googleId },
    });
    return NextResponse.json({ linked: true, email: identity.email });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Unlink Google — only allowed if a password is set, so the user keeps a way in.
export async function DELETE() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    const row = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { password: true },
    });
    if (!row?.password) {
      return badRequest("Сначала задайте пароль, иначе потеряете доступ к аккаунту");
    }
    await prisma.user.update({
      where: { id: user.userId },
      data: { googleId: null },
    });
    return NextResponse.json({ linked: false });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
