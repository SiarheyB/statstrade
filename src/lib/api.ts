import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "./auth";
import { prisma } from "./db";
import { logError } from "./errorLog";

// Throttle lastSeenAt writes: at most once per user per hour. Kept in-process
// (long-running container) so we avoid a DB read/write on every request — the
// signal only needs hour-granularity for adaptive sync backoff.
const SEEN_THROTTLE_MS = 60 * 60 * 1000;
const lastSeenWrites = new Map<string, number>();

function touchLastSeen(userId: string): void {
  const now = Date.now();
  const prev = lastSeenWrites.get(userId) ?? 0;
  if (now - prev < SEEN_THROTTLE_MS) return;
  lastSeenWrites.set(userId, now);
  // Fire-and-forget: never block the request, never throw on it.
  prisma.user
    .update({ where: { id: userId }, data: { lastSeenAt: new Date(now) } })
    .catch(() => lastSeenWrites.delete(userId));
}

// Resolve the current user from the session cookie, or null.
export async function getAuthUser(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (session) touchLastSeen(session.userId);
  return session;
}

export function unauthorized() {
  return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

// Полное сообщение — только в лог ошибок (админка); клиенту всегда generic,
// чтобы не светить внутренности (Prisma/ccxt/пути) наружу.
export function serverError(message: string) {
  logError(message);
  return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
}

// 429 для превышения rate-limit (регистрация/вход). Retry-After — в секундах.
export function tooManyRequests(retryAfterSec: number) {
  return NextResponse.json(
    { error: "Слишком много попыток, попробуйте позже" },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

// Cache-Control for user-independent GET responses (news, calendar, liqmap …).
// `public` lets a shared cache (Cloudflare edge / any CDN) and the browser hold
// the same payload for `maxAgeSec`, then keep serving the stale copy for
// `swrSec` while it revalidates in the background. Only attach to 2xx responses
// — never to the 401 from `unauthorized()`.
//
// NB: do NOT use `max-age=0` here — Cloudflare reads that as "no-cache" and
// returns cf-cache-status: BYPASS, defeating the edge cache. A short positive
// max-age is fine; manual refresh in the UI hits `?refresh=1`, which skips this
// header entirely and goes to origin.
//
// NOTE: these endpoints are auth-gated but return PUBLIC market data. A
// Cloudflare Cache Rule marking these paths "Eligible for cache" is what
// activates edge caching (see docs/local/OPTIMIZATION.md). The default cache key
// already ignores cookies, so the same cached copy is shared across users.
export function sharedCacheHeaders(maxAgeSec: number, swrSec: number): HeadersInit {
  return {
    "Cache-Control": `public, max-age=${maxAgeSec}, s-maxage=${maxAgeSec}, stale-while-revalidate=${swrSec}`,
  };
}
