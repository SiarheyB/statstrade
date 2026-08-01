import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getAuthUser } from "@/lib/api";
import { getAuthUrl, isYandexDiskConfigured } from "@/lib/integrations/yandexDisk";
import { rateLimit, clientIp } from "@/lib/ratelimit";

const STATE_COOKIE = "ts_ydisk_state";
const STATE_MAX_AGE = 60 * 10; // 10 минут на прохождение consent-экрана

// Начинает OAuth-подключение Яндекс.Диска: редиректит на consent screen.
// state — случайная строка, кладём её же в httpOnly cookie и сверяем в
// callback — защита от CSRF (подмены OAuth-редиректа третьей стороной).
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  if (!isYandexDiskConfigured()) {
    return NextResponse.json({ error: "Яндекс.Диск не настроен на сервере" }, { status: 503 });
  }

  const limit = rateLimit(`ydisk-connect:${clientIp(req)}:${user.userId}`, 10, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Слишком много попыток, попробуйте позже" }, { status: 429 });
  }

  const state = crypto.randomBytes(24).toString("hex");
  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_MAX_AGE,
  });

  return NextResponse.redirect(getAuthUrl(state));
}
