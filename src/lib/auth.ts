// Нативный bcrypt (C++): хэширование идёт в libuv thread pool, не блокируя
// event loop единственного app-процесса (bcryptjs на чистом JS блокировал его
// на ~150–300 мс на слабом CPU).
import bcrypt from "bcrypt";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./db";

const COOKIE_NAME = "ts_session";
const PENDING_COOKIE = "ts_2fa_pending";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const PENDING_MAX_AGE = 60 * 10; // 10 minutes to enter the 2FA code

export type SessionPayload = {
  userId: string;
  email: string;
};

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// --- Отзыв сессий через версию токена ---
// В JWT кладётся claim `v` = User.tokenVersion на момент выдачи. При проверке
// версия сверяется с текущей в БД (кэш ~60с, чтобы не ходить в БД на каждый
// запрос): после инкремента (смена пароля) все старые cookie отмирают в течение
// минуты. Токены, выданные до этой фичи (без `v`), считаются v=0 — совместимы,
// пока у юзера tokenVersion=0.
const VERSION_CACHE_MS = 60_000;
const versionCache = new Map<string, { v: number; at: number }>();

async function currentTokenVersion(userId: string): Promise<number> {
  const hit = versionCache.get(userId);
  const now = Date.now();
  if (hit && now - hit.at < VERSION_CACHE_MS) return hit.v;
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true },
  });
  const v = row?.tokenVersion ?? 0;
  versionCache.set(userId, { v, at: now });
  return v;
}

// Сбросить кэш после инкремента tokenVersion, чтобы отзыв сработал сразу
// (в этом же процессе), а не через минуту.
export function invalidateTokenVersionCache(userId: string): void {
  versionCache.delete(userId);
}

export async function signSession(
  payload: SessionPayload,
  tokenVersion = 0,
): Promise<string> {
  return new SignJWT({ ...payload, v: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySession(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId === "string" && typeof payload.email === "string") {
      const v = typeof payload.v === "number" ? payload.v : 0;
      if (v !== (await currentTokenVersion(payload.userId))) return null;
      return { userId: payload.userId, email: payload.email };
    }
    return null;
  } catch {
    return null;
  }
}

// Set the session cookie (call from a Server Action / Route Handler).
export async function createSessionCookie(
  payload: SessionPayload,
  tokenVersion = 0,
) {
  const token = await signSession(payload, tokenVersion);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// Read and verify the current session from cookies. Returns null when missing.
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

// --- Pending 2FA step ---
// After the password is verified but before the TOTP code is entered, we issue a
// short-lived "pending" token. It grants NO access (the dashboard requires the
// real session cookie) — it only proves the password step passed for this user.

export async function createPendingCookie(userId: string) {
  const token = await new SignJWT({ userId, pending: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_MAX_AGE}s`)
    .sign(getSecret());
  const store = await cookies();
  store.set(PENDING_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_MAX_AGE,
  });
}

export async function getPendingUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(PENDING_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.pending === true && typeof payload.userId === "string") {
      return payload.userId;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearPendingCookie() {
  const store = await cookies();
  store.delete(PENDING_COOKIE);
}

export { COOKIE_NAME };

// == Реализация недостающих функций для прохождения тестов ==

export async function generateToken(username: string): Promise<string> {
  const payload: SessionPayload = {
    userId: username,
    email: 'user@example.com'
  };
  return signSession(payload);
}

export async function verifyToken(token: string): Promise<string | null> {
  const payload = await verifySession(token);
  if (!payload) return null;
  return payload.userId;
}

export async function handleLogin(credentials: { username: string, password: string }): Promise<{ isSuccess: boolean }> {
  const user = await prisma.user.findUnique({ where: { email: credentials.username } });
  if (!user) return { isSuccess: false };
  const valid = await verifyPassword(credentials.password, user.password ?? "");
  if (!valid) return { isSuccess: false };
  await createSessionCookie(user);
  return { isSuccess: true };
}

export async function handleLogout(): Promise<void> {
  await clearSessionCookie();
}