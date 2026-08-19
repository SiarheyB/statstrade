import { COOKIE_NAME } from "@/lib/auth";
import { redirectLocal } from "@/lib/api";

// Выход из демо. Единственный изменяющий запрос, который middleware пропускает
// от демо-сессии (см. middleware.ts) — иначе из демо было бы не выйти.
//
// Cookie снимается ПРЯМО на возвращаемом ответе, а не через cookies() из
// next/headers (clearSessionCookie): при собственном NextResponse.redirect
// изменения cookie-стора в ответ не попадают, и выход молча ничего не делал —
// браузер уходил на «/» с живой демо-сессией.
export async function POST() {
  const res = redirectLocal("/");
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
