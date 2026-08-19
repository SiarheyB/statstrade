// Съём посещений на стороне сервера — вызывается из middleware.
//
// Почему на сервере, а не счётчиком в браузере: только так в статистику
// попадают (а) посетители с блокировщиками, (б) роботы, которые JS вообще не
// исполняют, — а именно про них и был вопрос «бот или человек». Браузерный
// маячок (TrafficBeacon) идёт вторым слоем и лишь подтверждает «JS исполнился».
//
// Middleware живёт в edge-рантайме, prisma там недоступна: событие уходит
// внутренним HTTP-запросом на 127.0.0.1 в /api/analytics/collect (node), и то
// через waitUntil — ответ пользователю оно не задерживает.

import type { NextRequest, NextFetchEvent, NextResponse } from "next/server";
import { buildHit, shortHash, SESSION_COOKIE, SESSION_MAX_AGE, VISITOR_COOKIE, VISITOR_MAX_AGE } from "./hit";
import { isTrackablePath } from "./paths";

function ingestUrl(): string {
  // Только петля: наружу (через публичный хост) запрос ходить не должен —
  // это лишний круг через туннель и лишний трафик.
  // Именно "localhost", а не "127.0.0.1": next dev на macOS слушает только
  // IPv6 (*:3000 → ::1), и запрос на IPv4-адрес просто виснет. Имя резолвится
  // в оба стека, и в контейнере (0.0.0.0), и локально.
  const base = process.env.ANALYTICS_INGEST_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${base.replace(/\/$/, "")}/api/analytics/collect`;
}

/** Общий секрет middleware ↔ роут приёма. Отдельная переменная не нужна. */
export async function ingestKey(): Promise<string> {
  return shortHash(`analytics-ingest|${process.env.ANALYTICS_INGEST_KEY || process.env.JWT_SECRET || "dev"}`);
}

/** Предзагрузка следующей страницы — не просмотр, иначе счётчик врёт в разы. */
function isPrefetch(req: NextRequest): boolean {
  const h = req.headers;
  return (
    h.get("next-router-prefetch") === "1" ||
    h.get("purpose") === "prefetch" ||
    h.get("x-purpose") === "preview" ||
    h.get("x-middleware-prefetch") === "1"
  );
}

/**
 * Считать ли этот запрос просмотром страницы.
 *
 * ГРАБЛИ: в Next 16 заголовки RSC-запросов (`RSC: 1`, `Next-Router-Prefetch: 1`)
 * до middleware НЕ доходят — фреймворк снимает их раньше (проверено на 16.3:
 * в middleware у запроса предзагрузки нет ни одного из них). Поэтому отличаем
 * настоящую загрузку страницы от служебного запроса по Sec-Fetch-*: у документа
 * dest=document / mode=navigate, у предзагрузки и подтяжки сегмента —
 * dest=empty. Без этого каждое наведение мыши на ссылку считалось бы
 * просмотром, и цифры были бы завышены в разы.
 *
 * Переходы внутри приложения (без перезагрузки страницы) серверный счётчик
 * таким образом не видит — их присылает браузерный маячок (TrafficBeacon),
 * который срабатывает только там, где реально сменился маршрут.
 *
 * У роботов и скриптов заголовков Sec-Fetch-* нет вовсе — для них решает
 * Accept: они обязаны попадать в статистику, ради них всё и затевалось.
 */
export function pageViewKind(req: NextRequest): "load" | "spa" | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  if (!isTrackablePath(req.nextUrl.pathname)) return null;
  if (isPrefetch(req)) return null;

  const dest = req.headers.get("sec-fetch-dest");
  const mode = req.headers.get("sec-fetch-mode");
  if (dest || mode) return dest === "document" || mode === "navigate" ? "load" : null;

  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/html") || accept === "*/*" || accept === "") return "load";
  return null;
}

export type Claims = { userId: string; email: string; demo?: boolean } | null;

/**
 * Проставить cookie посетителя/визита и отправить событие в приёмник.
 * Ошибки глотаются целиком: сломанная аналитика не имеет права влиять на сайт.
 */
export async function trackVisit(
  req: NextRequest,
  res: NextResponse,
  event: NextFetchEvent | undefined,
  claims: Claims,
): Promise<void> {
  try {
    if (process.env.ANALYTICS_ENABLED === "false") return;
    const nav = pageViewKind(req);
    if (!nav) return;

    const built = await buildHit({
      url: req.nextUrl,
      headers: req.headers,
      visitorCookie: req.cookies.get(VISITOR_COOKIE)?.value ?? null,
      sessionCookie: req.cookies.get(SESSION_COOKIE)?.value ?? null,
      authed: !!claims,
      userId: claims?.userId ?? null,
      nav,
    });

    const secure = process.env.NODE_ENV === "production";
    // httpOnly: cookie нужна только серверу; из JS её читать незачем.
    res.cookies.set(VISITOR_COOKIE, built.visitorId, {
      httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: VISITOR_MAX_AGE,
    });
    // Скользящие 30 минут: пауза дольше — и это уже следующий визит.
    res.cookies.set(SESSION_COOKIE, built.sessionId, {
      httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
    });

    // Без NextFetchEvent отправлять некуда и незачем: в реальном рантайме он
    // есть всегда, а его отсутствие означает вызов middleware напрямую из
    // теста — туда лезть по сети точно не надо.
    if (!event) return;
    event.waitUntil(
      fetch(ingestUrl(), {
        method: "POST",
        headers: { "content-type": "application/json", "x-analytics-key": await ingestKey() },
        body: JSON.stringify(built.hit),
      }).catch(() => {
        // приёмник недоступен (перезапуск app) — событие просто теряется
      }),
    );
  } catch {
    // никогда не мешаем основному ответу
  }
}
