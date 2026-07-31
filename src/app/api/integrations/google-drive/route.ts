import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { decrypt } from "@/lib/crypto";
import { isGoogleDriveConfigured, revokeToken } from "@/lib/integrations/googleDrive";

// Статус подключения Google Drive для текущего пользователя.
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const configured = isGoogleDriveConfigured();
  if (!configured) return NextResponse.json({ configured: false, connected: false });

  const acc = await prisma.cloudStorageAccount.findUnique({
    where: { userId_provider: { userId: user.userId, provider: "google_drive" } },
    select: { accountEmail: true },
  });

  return NextResponse.json({
    configured: true,
    connected: !!acc,
    email: acc?.accountEmail ?? null,
  });
}

// Отключить Google Drive. Сохранённые ранее ссылки на картинки НЕ трогаем —
// файлы публичные, продолжат открываться; отключается только возможность
// новых загрузок (см. план: пользователь может отключить/переподключить
// сервис независимо от уже загруженных скриншотов).
export async function DELETE() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    const acc = await prisma.cloudStorageAccount.findUnique({
      where: { userId_provider: { userId: user.userId, provider: "google_drive" } },
    });
    if (acc) {
      await revokeToken(decrypt(acc.refreshToken));
      await prisma.cloudStorageAccount.delete({ where: { id: acc.id } });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
