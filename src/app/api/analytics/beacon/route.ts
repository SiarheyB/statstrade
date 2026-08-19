// Браузерный маячок: второй слой сбора посещаемости.
//
// Что он даёт сверх серверного счётчика:
//  • подтверждение «JS исполнился» — визит помечается jsConfirmed, и в разрезе
//    «бот или человек» появляется третья, самая надёжная категория;
//  • переходы внутри приложения, которые не дошли до сервера (App Router
//    отдаёт часть переходов из клиентского кэша, без запроса за разметкой);
//  • разрешение экрана и document.referrer, которых в заголовках нет.
//
// Дублей с серверным событием не будет: recordHit склеивает одинаковый путь в
// одном визите в пределах 5 секунд.

import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { buildHit, SESSION_COOKIE, VISITOR_COOKIE } from "@/lib/traffic/hit";
import { recordHit } from "@/lib/traffic/ingest";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

const schema = z.object({
  path: z.string().max(300),
  referrer: z.string().max(300).nullable().optional(),
  screen: z.string().max(20).nullable().optional(),
});

export async function POST(req: Request) {
  // 120 маячков с адреса за минуту — с запасом на активную навигацию, но
  // накрутить счётчик скриптом уже не выйдет.
  if (!rateLimit(`beacon:${clientIp(req)}`, 120, 60_000).ok) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const h = await headers();
  const jar = await cookies();
  // Путь берём из тела (клиент знает свой реальный маршрут), остальное — из
  // заголовков запроса маячка.
  const origin = `https://${h.get("host") ?? "localhost"}`;
  let url: URL;
  try {
    url = new URL(parsed.data.path, origin);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const built = await buildHit({
    url,
    headers: h,
    visitorCookie: jar.get(VISITOR_COOKIE)?.value ?? null,
    sessionCookie: jar.get(SESSION_COOKIE)?.value ?? null,
    nav: "spa",
    refererOverride: parsed.data.referrer ?? null,
  });

  await recordHit({
    ...built.hit,
    js: true,
    screen: parsed.data.screen ?? null,
    // Авторизацию маячок не знает и знать не должен — её проставил серверный
    // счётчик, а update в recordHit никогда не сбрасывает флаг обратно.
  });

  return NextResponse.json({ ok: true });
}
