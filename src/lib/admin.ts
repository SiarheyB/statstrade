import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "./auth";
import { prisma } from "./db";

// Список администраторов задаётся через ENV (без миграции БД): ADMIN_EMAILS —
// e-mail'ы через запятую. Сравнение нечувствительно к регистру.
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
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

// Серверный гард для админских route-handler'ов и страниц. Возвращает сессию,
// если пользователь — админ, иначе null (вызывающий отдаёт 404, не светя
// существование раздела).
export async function getAdminSession(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!isAdminSession(session)) return null;
  return session;
}

// Унифицированный «404» для админских API — намеренно не 403, чтобы не
// раскрывать наличие раздела не-админам.
export function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

// Порог свежести фида карты ордеров: collector пишет снимок раз в ~2 c, поэтому
// отсутствие записей дольше этого считаем «фид отстал/упал».
export const FEED_STALE_MS = 90_000;

export type FeedFreshness = { symbol: string; exchange: string; lastT: Date | null; lagMs: number; stale: boolean };

// Свежесть каждого фида ObSnapshot (для алертов на «Обзоре» и странице collector).
export async function getFeedFreshness(): Promise<FeedFreshness[]> {
  const rows = await prisma.$queryRaw<{ symbol: string; exchange: string; last_t: Date | null }[]>`
    SELECT symbol, exchange, max(t) AS last_t
    FROM "ObSnapshot"
    GROUP BY symbol, exchange
    ORDER BY symbol, exchange
  `;
  const now = Date.now();
  return rows.map((r) => {
    const lagMs = r.last_t ? now - new Date(r.last_t).getTime() : Infinity;
    return { symbol: r.symbol, exchange: r.exchange, lastT: r.last_t, lagMs, stale: lagMs > FEED_STALE_MS };
  });
}

// Запись действия админа в аудит-лог (append-only, см. /admin/audit). Ошибка
// записи не должна валить само действие — логируем и продолжаем.
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
    console.error("[audit] не удалось записать:", (err as Error).message);
  }
}
