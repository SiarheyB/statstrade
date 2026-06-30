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
