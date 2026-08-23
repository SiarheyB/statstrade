import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { markPresence } from "@/lib/api";

export const dynamic = "force-dynamic";

// Маячок присутствия: «человек прямо сейчас за экраном».
//
// Шлёт его только PresenceBeacon и только когда вкладка видима И было действие
// пользователя за последние минуты. Всё остальное (фоновый опрос синка,
// поддержки, уведомлений) присутствием не считается — иначе «онлайн» в админке
// показывал бы просто число открытых где-то вкладок.
//
// Ответ пустой: клиенту от него ничего не нужно. Запись в БД троттлится
// в markPresence, так что частые пинги дешёвые.
export async function POST() {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 204 });
  markPresence(session.userId);
  return new NextResponse(null, { status: 204 });
}
