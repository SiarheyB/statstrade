import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "./auth";
import { prisma } from "./db";
import { logError } from "./errorLog";

// Global admin emails list - configurable via environment variable (no DB migration needed)
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

export function isAdminSession(session: SessionPayload | null): boolean {
  return isAdminEmail(session?.email);
}

/**
 * Get current user session if user is admin
 * Returns session object if admin, null otherwise
 */
export async function getAdminSession(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!isAdminEmail(session?.email)) {
    return null;
  }
  return session;
}

/**
 * Middleware helper for API routes that require admin access
 * Returns the admin session if authenticated, or a 401 Response if not
 */
export async function requireAdmin(): Promise<SessionPayload | Response> {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required" }, { status: 401 });
  }
  return session;
}

export function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export const ONLINE_THRESHOLD_MS = 10 * 60_000;

// Feed staleness threshold
export const FEED_STALE_MS = 90_000;
export type FeedFreshness = { symbol: string; exchange: string; lastT: Date | null; lagMs: number; stale: boolean };

/**
 * Get freshness of all orderbook feeds (from ObRollupBucket + ObSnapshot)
 * Returns freshness status per feed
 */
export async function getFeedFreshness(): Promise<FeedFreshness[]> {
  const feeds = await prisma.$queryRaw<{ symbol: string; exchange: string }[]>`
    SELECT DISTINCT symbol, exchange FROM "ObRollupBucket" ORDER BY symbol, exchange
  `;
  const now = Date.now();
  const out: FeedFreshness[] = [];
  for (const f of feeds) {
    const r = await prisma.$queryRaw<{ last_t: Date | null }[]>`
      SELECT max(t) AS last_t FROM "ObSnapshot"
      WHERE symbol = ${f.symbol} AND exchange = ${f.exchange}
    `;
    const lastT = r[0]?.last_t ?? null;
    const lagMs = lastT ? now - new Date(lastT).getTime() : Infinity;
    out.push({ symbol: f.symbol, exchange: f.exchange, lastT, lagMs, stale: lagMs > FEED_STALE_MS });
  }
  return out;
}

/**
 * Record admin action in the audit log (append-only)
 * Errors in audit recording never break the admin action
 */
export async function recordAudit(
  actor: SessionPayload,
  action: string,
  opts: { targetType?: string; targetId?: string; targetLabel?: string; detail?: string } = {},
): Promise<void> {
  try {
    await prisma.adminAudit.create({
      data: {
        actorId: actor.userId,
        actorEmail: actor.email,
        action,
        targetType: opts.targetType,
        targetId: opts.targetId,
        targetLabel: opts.targetLabel,
        detail: opts.detail,
      },
    });
  } catch (err) {
    console.error("[audit] error recording audit:", (err as Error).message);
  }
}

/**
 * Check if current user is admin
 * Returns boolean (useful for middleware, route guards, UI components)
 */
export async function adminCheck(): Promise<boolean> {
  const session = await getSession();
  if (!session?.user?.email) return false;
  return isAdminEmail(session.email);
}