import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import { exchangeCodeForTokens, getUserLogin, isYandexDiskConfigured, getPublicOrigin } from "@/lib/integrations/yandexDisk";
import { logError } from "@/lib/errorLog";

const STATE_COOKIE = "ts_ydisk_state";
const SETTINGS_URL = "/dashboard/settings";

// НЕ строим URL от req.url — за реверс-прокси (Tailscale Funnel/nginx) это
// внутренний адрес контейнера (http://localhost:3000), а не публичный домен
// (см. тот же фикс для google-drive/callback). Origin берём из
// YANDEX_DISK_REDIRECT_URI — он обязан быть публичным, иначе сам
// OAuth-обмен кода тоже не прошёл бы.
function redirectWithStatus(status: "connected" | "error"): NextResponse {
  const url = new URL(SETTINGS_URL, getPublicOrigin());
  url.searchParams.set("ydisk", status);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const user = await getAuthUser();
  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);

  if (!user || !isYandexDiskConfigured()) return redirectWithStatus("error");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // Сверка state — обязательна, защита от CSRF/подмены редиректа.
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectWithStatus("error");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const login = await getUserLogin(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await prisma.cloudStorageAccount.upsert({
      where: { userId_provider: { userId: user.userId, provider: "yandex_disk" } },
      create: {
        userId: user.userId,
        provider: "yandex_disk",
        accessToken: encrypt(tokens.access_token),
        refreshToken: encrypt(tokens.refresh_token),
        expiresAt,
        accountEmail: login,
      },
      update: {
        accessToken: encrypt(tokens.access_token),
        refreshToken: encrypt(tokens.refresh_token),
        expiresAt,
        accountEmail: login,
      },
    });

    return redirectWithStatus("connected");
  } catch (err) {
    logError((err as Error).message);
    return redirectWithStatus("error");
  }
}
