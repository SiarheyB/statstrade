import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError, readJsonBody } from "@/lib/api";
import { publicVapidKey } from "@/lib/push/server";

// Подписка браузера на push. Одна строка на устройство (см. модель
// PushSubscription): endpoint уникален сам по себе, поэтому повторная подписка
// того же браузера — это upsert, а не дубль.

/** Публичный VAPID-ключ + состояние подписки для текущего пользователя. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const key = publicVapidKey();
  const devices = key ? await prisma.pushSubscription.count({ where: { userId: user.userId } }) : 0;
  // key === null значит ключи на сервере не заданы — клиент по этому признаку
  // прячет кнопку подписки вместо того, чтобы уронить PushManager.subscribe.
  return NextResponse.json({ publicKey: key, devices });
}

type Body = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const body = (await readJsonBody(req)) as Body | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";
  // Оба ключа обязательны: без них payload нечем зашифровать, и отправка
  // упадёт уже в момент рассылки — то есть молча и не здесь.
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return badRequest("Некорректные данные подписки");
  }

  try {
    // userAgent — только чтобы человек в настройках понимал, что за устройство
    // он отписывает («Chrome на Windows»). Ни на что больше не влияет.
    const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: user.userId, endpoint, p256dh, auth, userAgent },
      // Тот же endpoint мог остаться от ДРУГОГО пользователя, если люди
      // делят браузер: перевешиваем строку на текущего и обнуляем счётчик
      // отказов — иначе прошлый владелец продолжал бы получать уведомления.
      update: { userId: user.userId, p256dh, auth, userAgent, failCount: 0 },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

/**
 * Копия настроек напоминаний о новостях для ЭТОГО устройства.
 *
 * Главными настройки остаются в localStorage браузера (см. econcalAlerts.ts) —
 * сюда шлётся копия, потому что крон, рассылающий push при закрытой вкладке,
 * localStorage не видит. Прислать её может только устройство со своей
 * подпиской, поэтому запрос адресуется по endpoint'у.
 */
export async function PUT(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const body = (await readJsonBody(req)) as (Body & { econcal?: unknown }) | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return badRequest("Не указано устройство");

  try {
    // Настройки складываем как есть: их разбирает и приводит к рабочему виду
    // normalizeAlertSettings на чтении — теми же правилами, что и браузер.
    // null означает «напоминания на этом устройстве не настраивали», и такая
    // подписка в рассылку календаря не попадает вовсе.
    const econcalPrefs =
      body?.econcal && typeof body.econcal === "object" ? JSON.stringify(body.econcal) : null;
    const { count } = await prisma.pushSubscription.updateMany({
      // userId в условии обязателен: иначе чужой endpoint правил бы чужие
      // настройки.
      where: { endpoint, userId: user.userId },
      data: { econcalPrefs },
    });
    // Подписки нет — это не ошибка запроса: браузер мог отписаться в другой
    // вкладке. Клиент по updated === 0 просто перепройдёт подписку.
    return NextResponse.json({ ok: true, updated: count });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

export async function DELETE(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const body = (await readJsonBody(req)) as Body | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  try {
    // Без endpoint — отписываем все устройства пользователя: это кнопка
    // «выключить уведомления везде» в настройках.
    const where = endpoint ? { userId: user.userId, endpoint } : { userId: user.userId };
    const { count } = await prisma.pushSubscription.deleteMany({ where });
    return NextResponse.json({ ok: true, removed: count });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
