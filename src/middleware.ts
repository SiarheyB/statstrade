import { NextResponse, type NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "ts_session";

// Таймаут по неактивности: срок жизни JWT — 5 часов, но на каждом
// аутентифицированном запросе (см. matcher ниже — включает /api/:path*,
// иначе фоновые запросы с открытой вкладки не продлевали бы сессию) мы
// перевыпускаем cookie с новым exp — "скользящее окно". Активный
// пользователь никогда не разлогинивается сам по себе; бездействующий
// 5+ часов — да, следующий запрос получит просроченный JWT.
// ВАЖНО: то же значение задано в lib/auth.ts (MAX_AGE_SECONDS) — держать в
// синхроне вручную, импортировать оттуда нельзя (тянет bcrypt, нативный
// аддон, несовместим с edge-рантаймом middleware).
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 5; // 5 hours

type SessionClaims = { userId: string; email: string; v?: number };

async function verifySessionClaims(
  token: string | undefined,
  secret: Uint8Array,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.userId === "string" && typeof payload.email === "string") {
      return { userId: payload.userId, email: payload.email, v: typeof payload.v === "number" ? payload.v : 0 };
    }
    return null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const secretStr = process.env.JWT_SECRET;
  const secret = secretStr ? new TextEncoder().encode(secretStr) : null;
  const claims = secret ? await verifySessionClaims(token, secret) : null;
  const valid = !!claims;

  // Protect the dashboard and admin area (the admin-role check is enforced in
  // the /admin layout & API since it needs ADMIN_EMAILS; here we only require a
  // valid session).
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/admin")) {
    if (!valid) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  // Keep authenticated users out of auth pages.
  if ((pathname === "/login" || pathname === "/register") && valid) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();

  // Скользящее продление: любой запрос с валидным токеном сбрасывает счётчик
  // бездействия. tokenVersion (отзыв при удалении/смене пароля) здесь не
  // проверяется — это лёгкая edge-проверка только подписи/exp; полноценная
  // DB-backed проверка (см. lib/auth.ts:getSession) всё равно происходит на
  // каждой странице /dashboard и /admin, так что продление истёкшего по
  // tokenVersion токена никого не пускает дальше него.
  if (valid && claims && secret) {
    const fresh = await new SignJWT({ userId: claims.userId, email: claims.email, v: claims.v })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
      .sign(secret);
    res.cookies.set(COOKIE_NAME, fresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  }

  return res;
}

export const config = {
  // /api/:path* — включая фоновые запросы (SyncProvider и т.п.) с уже
  // открытой вкладки, а не только переходы между страницами, иначе открытая
  // в фоне вкладка не продлевала бы сессию и разлогинивала бы активного юзера.
  matcher: ["/dashboard/:path*", "/admin/:path*", "/login", "/register", "/api/:path*"],
};
