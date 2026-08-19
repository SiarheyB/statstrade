import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { isDemoBlocked } from "@/lib/demoAccess";
import { trackVisit } from "@/lib/traffic/track";
import { isScannerPath } from "@/lib/traffic/bots";

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

// Методы, не меняющие состояние: их демо-сессии разрешены.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Изменяющие запросы, которые демо-сессии всё же разрешены. Без
// /api/auth/logout кнопка «Выйти» в меню молча получала 403 — cookie
// оставалась, и гость не мог выйти из демо штатным способом.
// «/api/demo» — вход в демо: если демо-cookie уже стоит (повторный клик по
// кнопке на лендинге, старая сессия в браузере), запрос обязан пройти, иначе
// вместо дашборда пользователь видит 403 «изменения недоступны».
const LOGOUT_PATHS = new Set(["/api/demo/exit", "/api/auth/logout"]);
const DEMO_ALLOWED_MUTATIONS = new Set(["/api/demo", "/api/demo/exit", "/api/auth/logout"]);

type SessionClaims = { userId: string; email: string; v?: number; demo?: boolean };

async function verifySessionClaims(
  token: string | undefined,
  secret: Uint8Array,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.userId === "string" && typeof payload.email === "string") {
      return {
        userId: payload.userId,
        email: payload.email,
        v: typeof payload.v === "number" ? payload.v : 0,
        demo: payload.demo === true,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Статистика посещаемости: обёртка вокруг всей логики ниже. Считаем ПОСЛЕ
// того, как основной обработчик принял решение (в т.ч. на редиректах гостя с
// /dashboard на /login — это тоже визит), но до отдачи ответа: сюда же
// вешаются cookie посетителя/визита. Внутри всё в try/catch — см. track.ts.
export async function middleware(req: NextRequest, event: NextFetchEvent) {
  // Пути, по которым ходят только сканеры уязвимостей (/wp-login.php, /.env,
  // /phpmyadmin — таких маршрутов у приложения нет и не будет). Отвечаем сразу
  // коротким 404, не поднимая рендер страницы 404: на домашнем мини-ПК это
  // заметная разница, когда бот перебирает сотни путей подряд. В статистику
  // такой запрос всё равно попадает — по нему в /admin/traffic видно, что сайт
  // щупают, и срабатывает оповещение о всплеске сканеров.
  if (isScannerPath(req.nextUrl.pathname)) {
    const blocked = new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
    await trackVisit(req, blocked, event, null);
    return blocked;
  }

  const { res, claims } = await handle(req);
  await trackVisit(req, res, event, claims);
  return res;
}

async function handle(req: NextRequest): Promise<{ res: NextResponse; claims: SessionClaims | null }> {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const secretStr = process.env.JWT_SECRET;
  const secret = secretStr ? new TextEncoder().encode(secretStr) : null;
  const claims = secret ? await verifySessionClaims(token, secret) : null;
  const valid = !!claims;

  // Второй рубеж для админского API. Гард ниже смотрит на префикс "/admin", а
  // путь "/api/admin/..." начинается с "/api" и под него НЕ подпадал — из-за
  // этого роуты бэкапа какое-то время были доступны анонимно (SECURITY_AUDIT.md).
  // Роль (ADMIN_EMAILS) здесь не проверяем: в edge-рантайме middleware env
  // может быть подставлен на этапе сборки, а образ собирается без этой
  // переменной. Роль проверяет getAdminSession() в каждом роуте; здесь мы
  // гарантируем только то, что анонима не будет ни при каких обстоятельствах.
  if (pathname.startsWith("/api/admin") && !valid) {
    return { res: NextResponse.json({ error: "Not found" }, { status: 404 }), claims };
  }

  // Protect the dashboard and admin area (the admin-role check is enforced in
  // the /admin layout & API since it needs ADMIN_EMAILS; here we only require a
  // valid session).
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/admin")) {
    if (!valid) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return { res: NextResponse.redirect(url), claims };
    }
  }

  // Keep authenticated users out of auth pages.
  if ((pathname === "/login" || pathname === "/register") && valid) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return { res: NextResponse.redirect(url), claims };
  }

  // Демо-сессия («посмотреть без регистрации», см. lib/demoSession.ts) —
  // строго только чтение. Гард стоит здесь, а не в семи десятках роутов: один
  // общий демо-аккаунт иначе испортил бы любой гость первым же POST. Выход из
  // демо — единственное исключение, иначе из него было бы не выйти.
  // Разделы, закрытые в демо (см. lib/demoAccess.ts). Гард здесь, а не только
  // в меню: спрятанный пункт всё равно открывался бы по прямому адресу.
  if (claims?.demo && isDemoBlocked(pathname)) {
    if (pathname.startsWith("/api/")) {
      return { res: NextResponse.json({ error: "Раздел недоступен в демо-режиме" }, { status: 403 }), claims };
    }
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return { res: NextResponse.redirect(url), claims };
  }

  if (claims?.demo && !SAFE_METHODS.has(req.method) && !DEMO_ALLOWED_MUTATIONS.has(pathname)) {
    return {
      res: NextResponse.json(
        { error: "Демо-режим: изменения недоступны. Создайте аккаунт, чтобы работать со своими данными." },
        { status: 403 },
      ),
      claims,
    };
  }

  const res = NextResponse.next();

  // Скользящее продление: любой запрос с валидным токеном сбрасывает счётчик
  // бездействия. tokenVersion (отзыв при удалении/смене пароля) здесь не
  // проверяется — это лёгкая edge-проверка только подписи/exp; полноценная
  // DB-backed проверка (см. lib/auth.ts:getSession) всё равно происходит на
  // каждой странице /dashboard и /admin, так что продление истёкшего по
  // tokenVersion токена никого не пускает дальше него.
  // Продление НЕ делаем на запросах выхода: иначе middleware переставил бы
  // свежую cookie поверх той, что роут только что снял, и выйти было бы нельзя.
  if (valid && claims && secret && !LOGOUT_PATHS.has(pathname)) {
    const fresh = await new SignJWT({
      userId: claims.userId,
      email: claims.email,
      demo: claims.demo === true,
      v: claims.v,
    })
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

  return { res, claims };
}

export const config = {
  // Раньше здесь был точечный список (/dashboard, /admin, /login, /register,
  // /api) — ровно то, что нужно гардам. Теперь matcher сплошной: статистика
  // посещаемости обязана видеть и публичные страницы (лендинг, /news,
  // /calendar, /share/…), иначе главный вопрос «сколько людей вообще заходит»
  // остаётся без ответа. На гарды это не влияет — они по-прежнему смотрят на
  // префикс пути; добавилось лишь продление сессии на публичных страницах.
  // /api/:path* по-прежнему внутри: фоновые запросы (SyncProvider и т.п.) с уже
  // открытой вкладки должны продлевать сессию, иначе открытая в фоне вкладка
  // разлогинивала бы активного пользователя.
  // Исключены статика Next и файлы с расширением — там нечего проверять и
  // нечего считать.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|map|txt|xml|json|woff2?|ttf)$).*)",
  ],
};
