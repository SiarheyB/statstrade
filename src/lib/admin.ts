import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "./auth";

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
