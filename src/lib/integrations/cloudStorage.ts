import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { refreshAccessToken } from "@/lib/integrations/googleDrive";

// Проверенное соединение пользователя с Google Drive. Если access_token
// истёк (или истекает в ближайшую минуту) — обновляем через refresh_token и
// перезаписываем зашифрованные значения в БД, чтобы не рефрешить на каждый
// запрос.
export async function getValidGoogleDriveToken(userId: string): Promise<string | null> {
  const acc = await prisma.cloudStorageAccount.findUnique({
    where: { userId_provider: { userId, provider: "google_drive" } },
  });
  if (!acc) return null;

  const expiringSoon = acc.expiresAt.getTime() - Date.now() < 60_000;
  if (!expiringSoon) return decrypt(acc.accessToken);

  const refreshed = await refreshAccessToken(decrypt(acc.refreshToken));
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
