import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { decrypt } from "@/lib/crypto";
import { isYandexDiskConfigured, revokeToken } from "@/lib/integrations/yandexDisk";

// Статус подключения Яндекс.Диска для текущего пользователя.
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const configured = isYandexDiskConfigured();
  if (!configured) return NextResponse.json({ configured: false, connected: false });

  const acc = await prisma.cloudStorageAccount.findUnique({
    where: { userId_provider: { userId: user.userId, provider: "yandex_disk" } },
    select: { accountEmail: true },
  });

  return NextResponse.json({
    configured: true,
    connected: !!acc,
    email: acc?.accountEmail ?? null,
  });
}

// Отключить Яндекс.Диск. В отличие от Google Drive (постоянная прямая
// ссылка), просмотр скриншотов с Яндекс.Диска идёт через
// /api/trade-images/view, которому нужен действующий токен, — после
// отключения такие ссылки перестанут открываться (в UI это видно кнопкой
// «Загрузить» вместо ссылки не будет, только для новых сделок; у уже
// прикреплённых картинок ссылка в БД остаётся, но по клику будет ошибка,
// пока пользователь не переподключит Яндекс.Диск). Сами файлы на диске
// пользователя при этом не удаляются.
export async function DELETE() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    const acc = await prisma.cloudStorageAccount.findUnique({
      where: { userId_provider: { userId: user.userId, provider: "yandex_disk" } },
    });
    if (acc) {
      await revokeToken(decrypt(acc.accessToken));
      await prisma.cloudStorageAccount.delete({ where: { id: acc.id } });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
