import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "./auth";
import { prisma } from "./db";

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

export function serverError(message: string) {
  return NextResponse.json({ error: message }, { status: 500 });
}

// Cache-Control for user-independent GET responses (news, calendar, liqmap …).
// `public` + `s-maxage` lets a shared cache (Cloudflare edge / any CDN) serve
// the same payload to everyone for `maxAgeSec`, then keep serving the stale copy
// for `swrSec` while it revalidates in the background. Browsers aren't trusted
// to hold it (`max-age=0`) so a manual refresh always re-checks. Only attach to
// 2xx responses — never to the 401 from `unauthorized()`.
//
// NOTE: these endpoints are auth-gated but return PUBLIC market data. A
// Cloudflare Cache Rule that ignores the session cookie is what actually
// activates edge caching (see docs/local/OPTIMIZATION.md). That makes the
// payload reachable by anon requests too — fine here, the data isn't private.
export function sharedCacheHeaders(maxAgeSec: number, swrSec: number): HeadersInit {
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${maxAgeSec}, stale-while-revalidate=${swrSec}`,
  };
}
