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
//
// Список фидов берём из маленькой ObRollupBucket (а НЕ сканируем сырую
// ObSnapshot — на разросшейся таблице GROUP BY вешал страницу /admin). Время
// последнего снапшота для каждого фида — точечный max(t) по индексу
// (symbol,exchange,t): мгновенно при любом размере таблицы.
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
