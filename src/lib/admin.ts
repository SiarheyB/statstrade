import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "./auth";
import { prisma } from "./db";

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

// «Онлайн» = маячок присутствия (см. /api/presence) приходил недавно. Маячок
// шлётся раз в минуту, пока вкладка видима и человек что-то делал, поэтому
// 5 минут — это «прямо сейчас за экраном» с запасом на сетевые перерывы.
// Считать по lastSeenAt нельзя: его поднимает фоновый опрос открытой вкладки.
export const ONLINE_THRESHOLD_MS = 5 * 60_000;

// Feed staleness threshold
export const FEED_STALE_MS = 90_000;
export type FeedFreshness = { symbol: string; exchange: string; lastT: Date | null; lagMs: number; stale: boolean };

/**
 * Get freshness of all orderbook feeds (from ObRollupBucket + ObSnapshot)
 * Returns freshness status per feed
 */
/**
 * Список фидов — «прыгающим» обходом первичного ключа, а не DISTINCT.
 *
 * `SELECT DISTINCT symbol, exchange` планировщик выполняет полным проходом:
 * на проде это 172 тыс. строк (54 МБ) на каждый вызов, а админка опрашивает
 * раздел «Карта ордеров» постоянно. Здесь берём первую пару, затем каждую
 * следующую БОЛЬШУЮ найденной — по одной строке индекса на пару (их единицы)
 * вместо одной на бакет. Postgres такой план сам не строит, отсюда
 * рекурсивный CTE; тот же приём, что в lib/landing.ts для счётчика символов.
 *
 * Источник — ObRollupBucket, а не конфигурация: фид, сбор которого выключили,
 * должен остаться в списке, пока его данные лежат в базе.
 */
export async function listCollectorFeeds(): Promise<{ symbol: string; exchange: string }[]> {
  return prisma.$queryRaw<{ symbol: string; exchange: string }[]>`
    WITH RECURSIVE pairs AS (
      (SELECT "symbol", "exchange" FROM "ObRollupBucket" ORDER BY "symbol", "exchange" LIMIT 1)
      UNION ALL
      SELECT n."symbol", n."exchange" FROM pairs p
      CROSS JOIN LATERAL (
        SELECT b."symbol", b."exchange" FROM "ObRollupBucket" b
        WHERE (b."symbol", b."exchange") > (p."symbol", p."exchange")
        ORDER BY b."symbol", b."exchange" LIMIT 1
      ) n
    )
    SELECT "symbol", "exchange" FROM pairs ORDER BY "symbol", "exchange"
  `;
}

/**
 * Свежесть фидов. `max(t)` ограничен окном: без него запрос обходит ВСЕ
 * дневные партиции ObSnapshot, хотя ответ нужен только чтобы понять, отстал ли
 * фид больше чем на FEED_STALE_MS (90 секунд). Ничего свежее суток за этой
 * границей быть не может, а «фид молчит дольше суток» и «фида нет вовсе» для
 * админки одно и то же.
 */
const FRESHNESS_WINDOW = "24 hours";

export async function getFeedFreshness(): Promise<FeedFreshness[]> {
  const feeds = await listCollectorFeeds();
  const now = Date.now();
  const results = await Promise.all(
    feeds.map((f) =>
      prisma
        .$queryRaw<{ last_t: Date | null }[]>`
          SELECT max(t) AS last_t FROM "ObSnapshot"
          WHERE symbol = ${f.symbol} AND exchange = ${f.exchange}
            AND t > now() - ${FRESHNESS_WINDOW}::interval
        `
        .then((r) => ({ ...f, lastT: r[0]?.last_t ?? null })),
    ),
  );
  return results.map((r) => {
    const lagMs = r.lastT ? now - new Date(r.lastT).getTime() : Infinity;
    return { symbol: r.symbol, exchange: r.exchange, lastT: r.lastT, lagMs, stale: lagMs > FEED_STALE_MS };
  });
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
  if (!session?.email) return false;
  return isAdminEmail(session.email);
}