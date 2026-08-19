// Запись событий посещаемости в БД. Только node-рантайм (prisma).
//
// Вызывается из /api/analytics/collect (сервер, каждый просмотр страницы) и
// /api/analytics/beacon (браузерный маячок). Всё «тихое»: аналитика не имеет
// права ни замедлить, ни уронить ответ пользователю — любая ошибка глотается.

import { prisma } from "@/lib/db";
import type { TrafficHit } from "./hit";

/** Сбор можно полностью выключить переменной окружения. */
export function analyticsEnabled(): boolean {
  return process.env.ANALYTICS_ENABLED !== "false";
}

/** Сколько суток держать сырые просмотры (агрегаты живут вечно). */
export function retentionDays(): number {
  const n = Number(process.env.ANALYTICS_RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 90;
}

// Защита от заливки таблицы: один посетитель — не больше 240 просмотров в
// минуту. Столько не набьёт ни один человек; столько набивает сканер, который
// за минуту перебирает пути. Лишнее просто отбрасывается.
const FLOOD_LIMIT = 240;
const FLOOD_WINDOW_MS = 60_000;
const floodCounters = new Map<string, { n: number; resetAt: number }>();

export function floodCheck(key: string, now = Date.now()): boolean {
  const cur = floodCounters.get(key);
  if (!cur || now > cur.resetAt) {
    // Заодно подчищаем протухшие ключи, чтобы Map не рос бесконечно.
    if (floodCounters.size > 5000) {
      for (const [k, v] of floodCounters) if (now > v.resetAt) floodCounters.delete(k);
    }
    floodCounters.set(key, { n: 1, resetAt: now + FLOOD_WINDOW_MS });
    return true;
  }
  if (cur.n >= FLOOD_LIMIT) return false;
  cur.n += 1;
  return true;
}

/** Просмотр той же страницы в том же визите за это время считается дублем. */
const DEDUPE_MS = 5000;

/**
 * Записать просмотр страницы: строка в PageView + обновление визита.
 *
 * Дубли: серверный сбор (middleware) и браузерный маячок видят одну и ту же
 * навигацию. Второй записи не будет — если такой же путь в этом визите уже
 * пришёл за последние 5 секунд, событие не дублируется, но визит всё равно
 * помечается как «JS исполнился» (это и есть главная польза маячка).
 */
export async function recordHit(hit: TrafficHit, now: Date = new Date()): Promise<"created" | "duplicate" | "skipped"> {
  if (!analyticsEnabled()) return "skipped";
  if (!floodCheck(hit.visitorId, now.getTime())) return "skipped";

  try {
    // Проверку на дубль делаем только для маячка: серверный счётчик — источник
    // истины, и лишний запрос к БД на каждый просмотр страницы ему ни к чему.
    // Два быстрых обновления страницы подряд — это честно два просмотра.
    const dupe = hit.js
      ? await prisma.pageView.findFirst({
          where: { sessionId: hit.sessionId, path: hit.path, ts: { gte: new Date(now.getTime() - DEDUPE_MS) } },
          select: { id: true },
        })
      : null;

    if (!dupe) {
      await prisma.pageView.create({
        data: {
          ts: now,
          sessionId: hit.sessionId,
          visitorId: hit.visitorId,
          path: hit.path,
          isBot: hit.isBot,
          botName: hit.botName,
          botCategory: hit.botCategory,
          source: hit.source,
          refHost: hit.refHost,
          utmSource: hit.utmSource,
          utmMedium: hit.utmMedium,
          utmCampaign: hit.utmCampaign,
          device: hit.device,
          browser: hit.browser,
          os: hit.os,
          lang: hit.lang,
          country: hit.country,
          authed: hit.authed,
          userId: hit.userId,
          nav: hit.nav,
        },
      });
    }

    await prisma.visitSession.upsert({
      where: { id: hit.sessionId },
      create: {
        id: hit.sessionId,
        visitorId: hit.visitorId,
        startedAt: now,
        lastSeenAt: now,
        views: dupe ? 0 : 1,
        entryPath: hit.path,
        exitPath: hit.path,
        isBot: hit.isBot,
        botName: hit.botName,
        botCategory: hit.botCategory,
        botReason: hit.botReason,
        jsConfirmed: hit.js === true,
        source: hit.source,
        refHost: hit.refHost,
        referrer: hit.referrer,
        utmSource: hit.utmSource,
        utmMedium: hit.utmMedium,
        utmCampaign: hit.utmCampaign,
        device: hit.device,
        browser: hit.browser,
        os: hit.os,
        lang: hit.lang,
        country: hit.country,
        screen: hit.screen ?? null,
        userAgent: hit.userAgent,
        authed: hit.authed,
        userId: hit.userId,
      },
      update: {
        lastSeenAt: now,
        exitPath: hit.path,
        ...(dupe ? {} : { views: { increment: 1 } }),
        ...(hit.js ? { jsConfirmed: true } : {}),
        ...(hit.screen ? { screen: hit.screen } : {}),
        // Авторизация внутри визита: гость зашёл и вошёл в аккаунт — важно для
        // воронки, поэтому проставляем, но никогда не сбрасываем обратно.
        ...(hit.authed ? { authed: true } : {}),
        ...(hit.userId ? { userId: hit.userId } : {}),
      },
    });

    return dupe ? "duplicate" : "created";
  } catch {
    // Аналитика не должна ломать запрос пользователя.
    return "skipped";
  }
}

/**
 * Отметить конверсию визита: регистрация или вход в аккаунт.
 * Отвечает на вопрос «сколько из зашедших дошли до аккаунта» — без этого
 * посещаемость остаётся цифрой без смысла.
 */
export async function markConversion(
  sessionId: string | null | undefined,
  kind: "registered" | "loggedIn",
  userId?: string | null,
): Promise<void> {
  if (!sessionId || !analyticsEnabled()) return;
  try {
    await prisma.visitSession.update({
      where: { id: sessionId },
      data: { [kind]: true, authed: true, ...(userId ? { userId } : {}) },
    });
  } catch {
    // визита нет (сбор выключен, cookie не дошла) — молча выходим
  }
}
