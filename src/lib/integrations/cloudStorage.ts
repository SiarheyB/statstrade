import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { refreshAccessToken as refreshGoogleDriveToken } from "@/lib/integrations/googleDrive";
import { refreshAccessToken as refreshYandexDiskToken } from "@/lib/integrations/yandexDisk";

export type CloudProvider = "google_drive" | "yandex_disk";

// Провайдер, к которому реально загружаем новый файл, если у пользователя
// подключено несколько. Google Drive — предпочтительный (стабильная прямая
// ссылка на файл без перевыпуска), Yandex — фолбэк.
export const PROVIDER_PRIORITY: CloudProvider[] = ["google_drive", "yandex_disk"];

async function refreshToken(provider: CloudProvider, refreshTokenValue: string) {
  return provider === "google_drive"
    ? refreshGoogleDriveToken(refreshTokenValue)
    : refreshYandexDiskToken(refreshTokenValue);
}

// Проверенное соединение пользователя с облачным провайдером. Если
// access_token истёк (или истекает в ближайшую минуту) — обновляем через
// refresh_token и перезаписываем зашифрованные значения в БД, чтобы не
// рефрешить на каждый запрос.
export async function getValidCloudToken(userId: string, provider: CloudProvider): Promise<string | null> {
  const acc = await prisma.cloudStorageAccount.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!acc) return null;

  const expiringSoon = acc.expiresAt.getTime() - Date.now() < 60_000;
  if (!expiringSoon) return decrypt(acc.accessToken);

  const refreshed = await refreshToken(provider, decrypt(acc.refreshToken));
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await prisma.cloudStorageAccount.update({
    where: { id: acc.id },
    data: {
      accessToken: encrypt(refreshed.access_token),
      expiresAt,
      // refresh_token обычно не переиздаётся при обновлении — сохраняем старый.
      ...(refreshed.refresh_token ? { refreshToken: encrypt(refreshed.refresh_token) } : {}),
    },
  });
  return refreshed.access_token;
}

// Первый подключённый провайдер по приоритету (см. PROVIDER_PRIORITY) — тот,
// в который пойдёт новая загрузка, если явный provider не передан.
export async function firstConnectedProvider(userId: string): Promise<CloudProvider | null> {
  const rows = await prisma.cloudStorageAccount.findMany({
    where: { userId, provider: { in: PROVIDER_PRIORITY } },
    select: { provider: true },
  });
  const connected = new Set(rows.map((r) => r.provider));
  for (const p of PROVIDER_PRIORITY) {
    if (connected.has(p)) return p;
  }
  return null;
}
